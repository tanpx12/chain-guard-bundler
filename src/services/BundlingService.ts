import { BigNumber, ethers, providers } from "ethers";
import { NetworkName } from "../types/networks";
import { EntryPoint__factory } from "../types/executor/contracts";
import { EntryPoint } from "../types/executor/contracts";
import { Mutex } from "async-mutex";
import { SendBundleReturn } from "../types/executor";
import { IMulticall3__factory } from "../types/executor/contracts/factories/IMulticall3__factory";
import { getAddr } from "../utils";
import { MempoolEntry } from "../models/MempoolEntry";
import { ReputationStatus } from "../models/EntitiesInterface";
import { Config } from "../common/config";
import { BundlingMode, Logger } from "../models/ExecutorInterface";
import { ReputationService } from "./ReputationService";
import {
  UserOpValidationResult,
  UserOpValidationService,
} from "./UserOpValidation";
import { MempoolService } from "./MempoolService";

export class BundlingService {
  private mutex: Mutex;
  private bundlingMode: BundlingMode;
  private autoBundlingInterval: number;
  private autoBundlingCron?: NodeJS.Timer;
  private maxMempoolSize: number;

  constructor(
    private network: NetworkName,
    private provider: providers.JsonRpcProvider,
    private mempoolService: MempoolService,
    private userOpValidationService: UserOpValidationService,
    private reputationService: ReputationService,
    private config: Config,
    private logger: Logger
  ) {
    this.mutex = new Mutex();

    this.bundlingMode = "auto";
    this.autoBundlingInterval = 15 * 1000;
    this.maxMempoolSize = 2;
    this.restartCron();
  }

  async sendNextBundle(): Promise<SendBundleReturn | null> {
    return await this.mutex.runExclusive(async () => {
      this.logger.debug("sendNextBundle");
      const bundle = await this.createBundle();
      if (bundle.length == 0) {
        this.logger.debug("sendNextBundle - no bundle");
        return null;
      }
      return await this.sendBundle(bundle);
    });
  }

  async sendBundle(bundle: MempoolEntry[]): Promise<SendBundleReturn | null> {
    if (!bundle.length) {
      return null;
    }
    const entryPoint = bundle[0].entryPoint;
    const entryPointContract = EntryPoint__factory.connect(
      entryPoint,
      this.provider
    );
    const wallet = this.config.getRelayer(this.network)!;
    const beneficiary = await this.selectBeneficiary();
    try {
      const txRequest = entryPointContract.interface.encodeFunctionData(
        "handleOps",
        [bundle.map((entry) => entry.userOp), beneficiary]
      );
      const tx = await wallet.sendTransaction({
        to: entryPoint,
        data: txRequest,
      });
      this.logger.debug(`Sent new bundle ${tx.hash}`);

      for (const entry of bundle) {
        await this.mempoolService.remove(entry);
      }

      const userOpHashes = await this.getUserOpHashes(
        entryPointContract,
        bundle
      );
      this.logger.debug(`User op hashes ${userOpHashes}`);
      return {
        transactionHash: tx.hash,
        userOpHashes: userOpHashes,
      };
    } catch (err: any) {
      if (err.errorName !== "FailedOp") {
        this.logger.error(`Failed handleOps, but non-Failedop error ${err}`);
        return null;
      }
      const { index, paymaster, reason } = err.errorArgs;
      const entry = bundle[index];
      if (paymaster !== ethers.constants.AddressZero) {
        await this.reputationService.crashedHandleOps(paymaster);
      } else if (typeof reason === "string" && reason.startsWith("AA1")) {
        const factory = getAddr(entry?.userOp.initCode);
        if (factory) {
          await this.reputationService.crashedHandleOps(factory);
        }
      } else {
        if (entry) {
          await this.mempoolService.remove(entry);
          this.logger.error(`Failed handleOps sender= ${entry.userOp.sender}`);
        }
      }
      return null;
    }
  }

  async createBundle(): Promise<MempoolEntry[]> {
    const entries = await this.mempoolService.getSortedOps();
    const bundle: MempoolEntry[] = [];

    const paymasterDeposit: { [key: string]: BigNumber } = {};
    const stakedEntityCount: { [key: string]: number } = {};
    const senders = new Set<string>();
    for (const entry of entries) {
      const paymaster = getAddr(entry.userOp.paymasterAndData);
      const factory = getAddr(entry.userOp.initCode);

      if (paymaster) {
        const paymasterStatus = await this.reputationService.getStatus(
          paymaster
        );
        if (paymasterStatus === ReputationStatus.BANNED) {
          await this.mempoolService.remove(entry);
          continue;
        } else if (
          paymasterStatus === ReputationStatus.THROTTLED ||
          (stakedEntityCount[paymaster] ?? 0) > 1
        ) {
          this.logger.debug("skipping throttled paymaster", {
            metadata: {
              senders: entry.userOp.sender,
              nonce: entry.userOp.nonce,
              paymaster,
            },
          });
          continue;
        }
      }

      if (factory) {
        const deployerStatus = await this.reputationService.getStatus(factory);
        if (deployerStatus === ReputationStatus.BANNED) {
          await this.mempoolService.remove(entry);
          continue;
        } else if (
          deployerStatus === ReputationStatus.THROTTLED ||
          (stakedEntityCount[factory] ?? 0) > 1
        ) {
          this.logger.debug("skipping throttled factory", {
            metadata: {
              senders: entry.userOp.sender,
              nonce: entry.userOp.nonce,
              paymaster,
            },
          });
          continue;
        }
      }

      if (senders.has(entry.userOp.sender)) {
        this.logger.debug("skipping already included sender", {
          metadata: {
            senders: entry.userOp.sender,
            nonce: entry.userOp.nonce,
          },
        });
        continue;
      }
      let validationResult: UserOpValidationResult;
      try {
        validationResult =
          await this.userOpValidationService.simulateCompleteValidation(
            entry.userOp,
            entry.entryPoint,
            entry.hash
          );
      } catch (e: any) {
        this.logger.debug(`failed 2nd validation: ${e.message}`);
        await this.mempoolService.remove(entry);
        continue;
      }
      const entryPointContract = EntryPoint__factory.connect(
        entry.entryPoint,
        this.provider
      );
      if (paymaster) {
        if (!paymasterDeposit[paymaster]) {
          paymasterDeposit[paymaster] = await entryPointContract.balanceOf(
            paymaster
          );
        }
        if (
          paymasterDeposit[paymaster]?.lt(validationResult.returnInfo.prefund)
        ) {
          // not enough balance in paymaster to pay for all UserOps
          // (but it passed validation, so it can sponsor them separately
          continue;
        }
        stakedEntityCount[paymaster] = (stakedEntityCount[paymaster] ?? 0) + 1;
        paymasterDeposit[paymaster] = BigNumber.from(
          paymasterDeposit[paymaster]?.sub(validationResult.returnInfo.prefund)
        );
      }
      if (factory) {
        stakedEntityCount[factory] = (stakedEntityCount[factory] ?? 0) + 1;
      }
      senders.add(entry.userOp.sender);
      bundle.push(entry);
    }
    return bundle;
  }

  setBundlingMode(mode: BundlingMode): void {
    this.bundlingMode = mode;
    this.restartCron();
  }

  setBundlingInterval(interval: number): void {
    if (interval > 1) {
      this.autoBundlingInterval = interval * 1000;
      this.restartCron();
    }
  }

  setMempoolMaxSize(size: number): void {
    this.maxMempoolSize = size;
    this.restartCron();
  }

  // INTERNAL METHOD

  private restartCron(): void {
    if (this.autoBundlingCron) {
      clearInterval(this.autoBundlingCron);
    }
    if (this.bundlingMode !== "auto") {
      return;
    }
    this.autoBundlingCron = setInterval(() => {
      void this.tryBundle();
    }, this.autoBundlingInterval);
  }

  private async tryBundle(force = true): Promise<void> {
    if (!force) {
      const count = await this.mempoolService.count();
      if (count < this.maxMempoolSize) {
        return;
      }
      await this.sendNextBundle();
    }
  }

  private async selectBeneficiary(): Promise<string> {
    const config = this.config.getNetworkConfig(this.network);
    let beneficiary = this.config.getBeneficiary(this.network);
    const signer = this.config.getRelayer(this.network);
    const signerAddress = await signer!.getAddress();
    const currentBalance = await this.provider.getBalance(signerAddress);

    if (currentBalance.lte(config!.minSignerBalance) || !beneficiary) {
      beneficiary = signerAddress;
      this.logger.info(
        `low balance on ${signerAddress}. using it as beneficiary`
      );
    }
    return beneficiary;
  }

  private async getUserOpHashes(
    entryPoint: EntryPoint,
    userOps: MempoolEntry[]
  ): Promise<string[]> {
    try {
      const config = this.config.getNetworkConfig(this.network);
      const multicall = IMulticall3__factory.connect(
        config!.multicall,
        this.provider
      );
      const callDatas = userOps.map((op) =>
        entryPoint.interface.encodeFunctionData("getUserOpHash", [op.userOp])
      );
      const result = await multicall.callStatic.aggregate3(
        callDatas.map((data) => ({
          target: entryPoint.address,
          callData: data,
          allowFailure: false,
        }))
      );
      return result.map((call) => call.returnData);
    } catch (err) {
      return [];
    }
  }
}
