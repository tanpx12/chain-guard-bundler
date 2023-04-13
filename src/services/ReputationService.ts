import { BigNumber, utils } from "ethers";
import { IDbController } from "../types/db";
import { ReputationEntry } from "../models/ReputationEntry";
import {
  ReputationEntryDump,
  ReputationEntrySerialized,
  ReputationStatus,
} from "../models/EntitiesInterface";
import { StakeInfo } from "./UserOpValidation";

export class ReputationService {
  private REP_COLL_KEY: string;
  private WL_COLL_KEY: string;
  private BL_COLL_KEY: string;

  constructor(
    private db: IDbController,
    private chainId: number,
    private minInclusionDenominator: number,
    private throttlingSlack: number,
    private banSlack: number,
    private readonly minStake: BigNumber,
    private readonly minUnstakeDelay: number
  ) {
    this.REP_COLL_KEY = `${chainId}:REPUTAION`;
    this.WL_COLL_KEY = `${this.REP_COLL_KEY}:WL`;
    this.BL_COLL_KEY = `${this.REP_COLL_KEY}:BL`;
  }

  async fetchOne(address: string): Promise<ReputationEntry> {
    const raw = await this.db
      .get<ReputationEntrySerialized>(this.getKey(address))
      .catch(() => null);
    let entry;
    if (!raw) {
      await this.addToCollection(address);
      entry = new ReputationEntry({
        chainId: this.chainId,
        address,
      });
    } else {
      entry = new ReputationEntry({
        chainId: this.chainId,
        address,
        opsSeen: raw.opsSeen,
        opsIncluded: raw.opsIncluded,
        lastUpdateTime: raw.lastUpdateTime,
      });
    }
    return entry;
  }

  async updateSeenStatus(address: string): Promise<void> {
    const entry = await this.fetchOne(address);
    entry.addToReputation(1, 0);
    await this.save(entry);
  }

  async updateIncludedStatus(address: string): Promise<void> {
    const entry = await this.fetchOne(address);
    entry.addToReputation(0, 1);
    await this.save(entry);
  }

  async getStatus(address: string): Promise<ReputationStatus> {
    const entry = await this.fetchOne(address);
    return entry.getStatus(
      this.minInclusionDenominator,
      this.throttlingSlack,
      this.banSlack
    );
  }

  async setStatus(
    address: string,
    opsSeen: number,
    opsIncluded: number
  ): Promise<void> {
    const entry = await this.fetchOne(address);
    entry.setReputation(opsSeen, opsIncluded);
    await this.save(entry);
  }

  async setReputation(
    address: string,
    opsSeen: number,
    opsIncluded: number
  ): Promise<void> {
    const entry = await this.fetchOne(address);
    entry.setReputation(opsSeen, opsIncluded);
    await this.save(entry);
  }

  async dump(): Promise<ReputationEntryDump[]> {
    const addresses: string[] = await this.db
      .get<string[]>(this.REP_COLL_KEY)
      .catch(() => []);
    const rawEntries: ReputationEntrySerialized[] = await this.db
      .getMany<ReputationEntrySerialized>(
        addresses.map((addr) => this.getKey(addr))
      )
      .catch(() => []);
    const entries = addresses
      .map(
        (address, i) =>
          new ReputationEntry({
            chainId: this.chainId,
            address,
            opsSeen: rawEntries[i]!.opsSeen,
            opsIncluded: rawEntries[i]!.opsIncluded,
          })
      )
      .map((entry) => ({
        address: entry.address,
        opsSeen: entry.opsSeen,
        opsIncluded: entry.opsIncluded,
        status: entry.getStatus(
          this.minInclusionDenominator,
          this.throttlingSlack,
          this.banSlack
        ),
      }));
    return entries;
  }

  async crashedHandleOps(address: string): Promise<void> {
    if (!address) return;
    // TODO
    await this.setReputation(address, 100, 0);
  }

  async clearState(): Promise<void> {
    const addresses: string[] = await this.db
      .get<string[]>(this.REP_COLL_KEY)
      .catch(() => []);
    for (const addr of addresses) {
      await this.db.del(this.getKey(addr));
    }
    await this.db.del(this.REP_COLL_KEY);
  }

  // CHECK STAKE STATE

  async checkStake(info: StakeInfo): Promise<string | null> {
    if (!info.addr || (await this.isWhitelisted(info.addr))) {
      return null;
    }
    if ((await this.getStatus(info.addr)) === ReputationStatus.BANNED) {
      return `${info.addr} is banned`;
    }
    if (BigNumber.from(info.unstakeDelaySec).lt(this.minUnstakeDelay)) {
      return `${info.addr} unstake delay ${info.unstakeDelaySec} is too low`;
    }
    return null;
  }

  // WHITELIST - BLACKLIST

  async isWhitelisted(addr: string): Promise<boolean> {
    const wl = await this.fetchWhitelist();
    return wl.findIndex((w) => w.toLowerCase() === addr.toLowerCase()) > -1;
  }

  async isBlacklisted(addr: string): Promise<boolean> {
    const bl = await this.fetchBlacklist();
    return bl.findIndex((b) => b.toLowerCase() === addr.toLowerCase()) > -1;
  }

  async fetchWhitelist(): Promise<string[]> {
    return await this.db.get<string[]>(this.WL_COLL_KEY).catch(() => []);
  }

  async fetchBlacklist(): Promise<string[]> {
    return await this.db.get<string[]>(this.BL_COLL_KEY).catch(() => []);
  }

  async addToWhitelist(address: string): Promise<void> {
    const wl: string[] = await this.db
      .get<string[]>(this.WL_COLL_KEY)
      .catch(() => []);
    wl.push(address);
    await this.db.put(this.WL_COLL_KEY, wl);
  }

  async addToBlacklist(address: string): Promise<void> {
    const bl: string[] = await this.db
      .get<string[]>(this.BL_COLL_KEY)
      .catch(() => []);
    bl.push(address);
    await this.db.put(this.BL_COLL_KEY, bl);
  }

  async removeFromWhitelist(address: string): Promise<void> {
    let wl: string[] = await this.db
      .get<string[]>(this.WL_COLL_KEY)
      .catch(() => []);
    wl.filter((addr) => utils.getAddress(address) !== utils.getAddress(addr));
    await this.db.put(this.WL_COLL_KEY, wl);
  }

  async removeFromBlacklist(address: string): Promise<void> {
    let bl: string[] = await this.db
      .get<string[]>(this.BL_COLL_KEY)
      .catch(() => []);
    bl.filter((addr) => utils.getAddress(address) !== utils.getAddress(addr));
    await this.db.put(this.BL_COLL_KEY, bl);
  }

  // INTERNAL FUNCTION

  private async save(entry: ReputationEntry): Promise<void> {
    await this.db.put(this.getKey(entry.address), entry.serialize());
  }

  private getKey(address: string): string {
    return `${this.REP_COLL_KEY}:${address}`;
  }

  private async addToCollection(address: string): Promise<void> {
    const addresses: string[] = await this.db
      .get<string[]>(this.REP_COLL_KEY)
      .catch(() => []);
    addresses.push(address);
    await this.db.put(this.REP_COLL_KEY, addresses);
  }
}
