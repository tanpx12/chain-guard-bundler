import { BigNumber, ethers } from "ethers";
import { arrayify, hexlify, isAddress } from "ethers/lib/utils";
import RpcError from "../types/api/errors/rpc-error";
import * as RpcErrorCodes from "../types/api/errors/rpc-error-codes";
import {
  EntryPoint,
  UserOperationEventEvent,
  UserOperationStruct,
} from "../types/executor/contracts/EntryPoint";
import {
  EstimatedUserOperationGas,
  UserOperationByHashResponse,
  UserOperationReceipt,
} from "../types/api/interfaces";
import { EntryPoint__factory } from "../types/executor/contracts";
import { NetworkConfig } from "../common/config";
import { deepHexlify, packUserOp } from "../utils";
import { UserOpValidationService } from "../services/UserOpValidation";
import { MempoolService } from "../services/MempoolService";
import { Log, Logger } from "../models/ExecutorInterface";
import {
  EstimateUserOperationGasArgs,
  SendUserOperationGasArgs,
} from "./interfaces";

export class Eth {
  constructor(
    private provider: ethers.providers.JsonRpcProvider,
    private userOpValidationService: UserOpValidationService,
    private mempoolService: MempoolService,
    private config: NetworkConfig,
    private logger: Logger
  ) {}

  static DefaultGasOverheads = {
    fixed: 21000,
    perUserOp: 18300,
    perUserOpWord: 4,
    zeroByte: 4,
    nonZeroByte: 16,
    bundleSize: 1,
    sigSize: 65,
  };

  async sendUserOperation(args: SendUserOperationGasArgs): Promise<string> {
    const userOp = args.userOp as unknown as UserOperationStruct;
    const entryPoint = args.entryPoint;
    if (!this.validateEntryPoint(entryPoint)) {
      throw new RpcError("Invalid Entrypoint", RpcErrorCodes.INVALID_REQUEST);
    }
    this.logger.debug("Validation user op before sending to mempool ...");
    const validationResult =
      await this.userOpValidationService.simulateCompleteValidation(
        userOp,
        entryPoint
      );
    this.logger.debug("Validation successful. Saving in mempool...");
    await this.mempoolService.addUserOp(
      userOp,
      entryPoint,
      validationResult.returnInfo.prefund.toString(),
      validationResult.senderInfo,
      validationResult.referencedContracts?.hash
    );

    this.logger.debug("Saved in mempool");

    const entryPointContract = EntryPoint__factory.connect(
      entryPoint,
      this.provider
    );
    return entryPointContract.getUserOpHash(userOp);
  }

  async validateUserOp(args: SendUserOperationGasArgs): Promise<boolean> {
    const { userOp, entryPoint } = args;
    if (!this.validateEntryPoint(entryPoint)) {
      throw new RpcError("Invalid Entrypoint", RpcErrorCodes.INVALID_REQUEST);
    }
    const validGasFees = await this.mempoolService.isNewOrReplacing(
      userOp,
      entryPoint
    );
    if (!validGasFees) {
      throw new RpcError(
        "User op cannot be replaced: fee too low",
        RpcErrorCodes.INVALID_USEROP
      );
    }
    await this.userOpValidationService.simulateCompleteValidation(
      userOp,
      entryPoint
    );
    return true;
  }

  async getUserOperationByHash(
    hash: string
  ): Promise<UserOperationByHashResponse | null> {
    const [entryPoint, event] = await this.getUserOperationEvent(hash);
    if (!entryPoint || !event) {
      return null;
    }
    const tx = await event.getTransaction();
    if (tx.to !== entryPoint.address) {
      throw new Error("unable to parse transaction");
    }
    const parsed = entryPoint.interface.parseTransaction(tx);
    const ops: UserOperationStruct[] = parsed?.args.ops;
    if (ops.length == 0) {
      throw new Error("failed to parse transaction");
    }
    const op = ops.find(
      (o) =>
        o.sender === event.args.sender &&
        BigNumber.from(o.nonce).eq(event.args.nonce)
    );
    if (!op) {
      throw new Error("unable to find userOp in transaction");
    }

    const {
      sender,
      nonce,
      initCode,
      callData,
      callGasLimit,
      verificationGasLimit,
      preVerificationGas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      paymasterAndData,
      signature,
    } = op;

    return deepHexlify({
      userOperation: {
        sender,
        nonce,
        initCode,
        callData,
        callGasLimit,
        verificationGasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas,
        preVerificationGas,
        paymasterAndData,
        signature,
      },
      entryPoint: entryPoint.address,
      transactionHash: tx.hash,
      blockHash: tx.blockHash ?? "",
      blockNumber: tx.blockNumber ?? 0,
    });
  }

  async getChainId(): Promise<number> {
    return (await this.provider.getNetwork()).chainId;
  }

  async getUserOperationReceipt(
    hash: string
  ): Promise<UserOperationReceipt | null> {
    const [entryPoint, event] = await this.getUserOperationEvent(hash);
    if (!event || !entryPoint) {
      return null;
    }
    const receipt = await event.getTransactionReceipt();
    const logs = this.filterLogs(event, receipt.logs);
    return deepHexlify({
      userOpHash: hash,
      sender: event.args.sender,
      nonce: event.args.nonce,
      actualGasCost: event.args.actualGasCost,
      actualGasUsed: event.args.actualGasUsed,
      success: event.args.success,
      logs,
      receipt,
    });
  }

  async estimateUserOperationGas(
    args: EstimateUserOperationGasArgs
  ): Promise<EstimatedUserOperationGas> {
    const { userOp, entryPoint } = args;
    if (!this.validateEntryPoint(entryPoint)) {
      throw new RpcError("Invalid Entrypoint", RpcErrorCodes.INVALID_REQUEST);
    }
    const userOpComplemented: UserOperationStruct = {
      ...userOp,
      paymasterAndData: "0x",
      maxFeePerGas: 0,
      maxPriorityFeePerGas: 0,
      preVerificationGas: 0,
      verificationGasLimit: 10e6,
    };
    const { returnInfo } =
      await this.userOpValidationService.callSimulateValidation(
        userOpComplemented,
        entryPoint
      );
    const callGasLimit = await this.provider
      .estimateGas({
        from: entryPoint,
        to: userOp.sender,
        data: userOp.callData,
      })
      .then((b) => b.toNumber())
      .catch((err) => {
        const msg =
          err.message.match(/reason="(.*?)"/)?.at(1) ?? "Execution reverted";
        throw new RpcError(msg, RpcErrorCodes.EXECUTION_REVERTED);
      });
    const preVerificationGas = this.calcPreVerificationGas(userOp);
    const verificationGas = BigNumber.from(returnInfo.preOpGas).toNumber();
    let deadline: any = undefined;
    if (returnInfo.deadline) {
      deadline = BigNumber.from(returnInfo.deadline);
    }
    return {
      preVerificationGas,
      verificationGas,
      callGasLimit,
      deadline: deadline,
    };
  }

  async getSupportedEntryPoints(): Promise<string[]> {
    return this.config.entryPoints.map((address) =>
      ethers.utils.getAddress(address)
    );
  }

  //INTERNAL METHODS

  private filterLogs(userOpEvent: UserOperationEventEvent, logs: Log[]): Log[] {
    let startIndex = -1;
    let endIndex = -1;
    logs.forEach((log, idx) => {
      if (log?.topics[0] === userOpEvent.topics[0]) {
        if (log.topics[1] === userOpEvent.topics[1]) {
          endIndex = idx;
        } else {
          if (endIndex === -1) {
            startIndex = idx;
          }
        }
      }
    });
    if (endIndex === -1) {
      throw new Error("fatal: no UserOperationEvent in logs");
    }
    return logs.slice(startIndex + 1, endIndex);
  }

  private async getUserOperationEvent(
    userOpHash: string
  ): Promise<[EntryPoint | null, UserOperationEventEvent | null]> {
    let event: UserOperationEventEvent[] = [];
    for (const addr of await this.getSupportedEntryPoints()) {
      const contract = EntryPoint__factory.connect(addr, this.provider);
      try {
        event = await contract.queryFilter(
          contract.filters.UserOperationEvent(userOpHash)
        );
        if (event[0]) {
          return [contract, event[0]];
        }
      } catch (err) {
        throw new RpcError(
          "Missing/invalid userOpHash",
          RpcErrorCodes.METHOD_NOT_FOUND
        );
      }
    }
    return [null, null];
  }

  private calcPreVerificationGas(
    userOp: Partial<UserOperationStruct>,
    overheads?: Partial<typeof Eth.DefaultGasOverheads>
  ): number {
    const ov = { ...Eth.DefaultGasOverheads, ...(overheads ?? {}) };
    const p: UserOperationStruct = {
      preVerificationGas: 21000, // mock value
      signature: hexlify(Buffer.alloc(ov.sigSize, 1)),
      ...userOp,
    } as any;
    const packed = arrayify(packUserOp(p, false));
    const callDataCost = packed
      .map((x) => (x === 0 ? ov.zeroByte : ov.nonZeroByte))
      .reduce((sum, x) => sum + x);
    const ret = Math.round(
      callDataCost +
        ov.fixed / ov.bundleSize +
        ov.perUserOp +
        ov.perUserOpWord * packed.length
    );
    return ret;
  }

  private validateEntryPoint(entryPoint: string): boolean {
    return (
      this.config.entryPoints.findIndex(
        (ep) => ep.toLowerCase() === entryPoint.toLowerCase()
      ) !== -1
    );
  }
}
