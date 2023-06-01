import { BigNumberish } from "ethers";
import { IDbController } from "../types/db";
import RpcError from "../types/api/errors/rpc-error";
import * as RpcErrorCodes from "../types/api/errors/rpc-error-codes";
import { UserOperationStruct } from "../types/executor/contracts/EntryPoint";
import { getAddr, now } from "../utils";
import { MempoolEntry } from "../models/MempoolEntry";
import {
  MempoolEntrySerialized,
  IMempoolEntry,
} from "../models/EntitiesInterface";
import { ReputationService } from "./ReputationService";
import { StakeInfo } from "./UserOpValidation";
import { hexValue } from "@ethersproject/bytes";

export class MempoolService {
  private MAX_MEMPOOL_USEROPS_PER_SENDER = 4;
  private USEROP_COLLECTION_KEY: string;
  constructor(
    private db: IDbController,
    private chainId: number,
    private reputationService: ReputationService
  ) {
    this.USEROP_COLLECTION_KEY = `${chainId}:USEROPKEYS`;
  }

  async count(): Promise<number> {
    const userOpKeys: string[] = await this.fetchKeys();
    return userOpKeys.length;
  }

  async dump(): Promise<MempoolEntrySerialized[]> {
    return (await this.fetchAll()).map((entry) => entry.serialize());
  }

  async addUserOp(
    userOp: UserOperationStruct,
    entryPoint: string,
    prefund: BigNumberish,
    senderInfo: StakeInfo,
    hash?: string,
    aggregator?: string
  ): Promise<void> {
    const entry = new MempoolEntry({
      chainId: this.chainId,
      userOp,
      entryPoint,
      prefund,
      aggregator,
      hash,
    });

    const isEntryExisted = await this.find(entry);
    if (isEntryExisted) {
      if (!entry.canReplace(isEntryExisted)) {
        throw new RpcError(
          "User op cannot be replaced: fee too low",
          RpcErrorCodes.INVALID_OPCODE
        );
      }
      await this.db.put(this.getKey(entry), {
        ...entry,
        lastUpdatedTime: now(),
      });
    } else {
      const checkState = await this.checkSenderCountInMempool(
        userOp,
        senderInfo
      );
      if (checkState) {
        throw new RpcError(checkState, RpcErrorCodes.INVALID_REQUEST);
      }
      const userOpKeys = await this.fetchKeys();
      const key = this.getKey(entry);
      userOpKeys.push(key);
      await this.db.put(this.USEROP_COLLECTION_KEY, userOpKeys);
      await this.db.put(key, { ...entry, lastUpdatedTime: now() });
    }
    await this.updateSeenStatus(userOp, aggregator);
  }

  async remove(entry: MempoolEntry | null): Promise<void> {
    if (!entry) {
      return;
    }
    const key = this.getKey(entry);
    const newKeys = (await this.fetchKeys()).filter((k) => k !== key);
    await this.db.del(key);
    await this.db.put(this.USEROP_COLLECTION_KEY, newKeys);
  }

  async removeUserOp(userOp: UserOperationStruct): Promise<void> {
    const entry = new MempoolEntry({
      chainId: this.chainId,
      userOp,
      entryPoint: "",
      prefund: 0,
    });
    await this.remove(entry);
  }

  async getSortedOps(): Promise<MempoolEntry[]> {
    const allEntries = await this.fetchAll();
    return allEntries.sort(MempoolEntry.compareByCost);
  }

  async clearState(): Promise<void> {
    const keys = await this.fetchKeys();
    for (const key of keys) {
      await this.db.del(key);
    }
    await this.db.del(this.USEROP_COLLECTION_KEY);
  }

  async isNewOrReplacing(
    userOp: UserOperationStruct,
    entryPoint: string
  ): Promise<boolean> {
    const entry = new MempoolEntry({
      chainId: this.chainId,
      userOp,
      entryPoint,
      prefund: "0",
    });
    const isEntryExisted = await this.find(entry);
    return !isEntryExisted || entry.canReplace(isEntryExisted);
  }

  // INTERNAL FUNCTION

  private async fetchKeys(): Promise<string[]> {
    const userOpKeys = await this.db
      .get<string[]>(this.USEROP_COLLECTION_KEY)
      .catch(() => []);
    return userOpKeys;
  }

  private async fetchAll(): Promise<MempoolEntry[]> {
    const keys = await this.fetchKeys();
    const rawEntries = await this.db
      .getMany<MempoolEntry>(keys)
      .catch(() => []);
    return rawEntries.map(this.rawEntryToMempoolEntry);
  }

  private async find(entry: MempoolEntry): Promise<MempoolEntry | null> {
    const raw = await this.db
      .get<IMempoolEntry>(this.getKey(entry))
      .catch(() => null);
    if (raw) {
      return this.rawEntryToMempoolEntry(raw);
    }
    return null;
  }

  private getKey(entry: IMempoolEntry): string {
    return `${this.chainId}:${entry.userOp.sender}:${entry.userOp.nonce}`;
  }

  private async updateSeenStatus(
    userOp: UserOperationStruct,
    aggregator?: string
  ): Promise<void> {
    const paymaster = getAddr(userOp.paymasterAndData);
    const sender = getAddr(userOp.sender);
    if (aggregator) {
      await this.reputationService.updateSeenStatus(aggregator);
    }
    if (paymaster) {
      await this.reputationService.updateSeenStatus(paymaster);
    }
    if (sender) {
      await this.reputationService.updateSeenStatus(sender);
    }
  }

  private async checkSenderCountInMempool(
    userOp: UserOperationStruct,
    userInfo: StakeInfo
  ): Promise<string | null> {
    const entries = await this.fetchAll();
    const count: number = entries.filter(
      ({ userOp: { sender } }) => sender === userOp.sender
    ).length;
    if (count >= this.MAX_MEMPOOL_USEROPS_PER_SENDER) {
      return this.reputationService.checkStake(userInfo);
    }
    return null;
  }

  private rawEntryToMempoolEntry(raw: IMempoolEntry): MempoolEntry {
    return new MempoolEntry({
      chainId: raw.chainId,
      userOp: raw.userOp,
      entryPoint: raw.entryPoint,
      prefund: raw.prefund,
      aggregator: raw.aggregator,
      hash: raw.hash,
    });
  }
}
