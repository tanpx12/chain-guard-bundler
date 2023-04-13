import { providers } from "ethers";
import RpcError from "../types/api/errors/rpc-error";
import * as RpcErrorCodes from "../types/api/errors/rpc-error-codes";
import { UserOperationStruct } from "../types/executor/contracts/EntryPoint";
import { BundlingService } from "../services/BundlingService";
import { MempoolService } from "../services/MempoolService";
import { ReputationService } from "../services/ReputationService";
import { BundlingMode } from "../models/ExecutorInterface";
import { ReputationEntryDump } from "../models/EntitiesInterface";
import { SetReputationArgs } from "./interfaces";

export class Debug {
  bundlingMode: BundlingMode = "auto";
  constructor(
    private provider: providers.JsonRpcProvider,
    private bundlingService: BundlingService,
    private mempoolService: MempoolService,
    private reputationService: ReputationService
  ) {}

  async setBundlingMode(mode: BundlingMode): Promise<string> {
    if (mode !== "auto" && mode !== "manual") {
      throw new RpcError("Method not supported", RpcErrorCodes.INVALID_REQUEST);
    }
    this.bundlingService.setBundlingMode(mode);
    return "ok";
  }

  async clearState(): Promise<string> {
    await this.mempoolService.clearState();
    await this.reputationService.clearState();
    return "ok";
  }

  async dumpMempool(): Promise<UserOperationStruct[]> {
    const entries = await this.mempoolService.dump();
    return entries.map((entry) => entry.userOp);
  }

  async sendBundleNow(): Promise<string> {
    await this.bundlingService.sendNextBundle();
    return "ok";
  }

  setbundlingInterval(interval: number): string {
    this.bundlingService.setBundlingInterval(interval);
    return "ok";
  }

  async setReputation(args: SetReputationArgs): Promise<string> {
    for (const reputation of args.reputations) {
      await this.reputationService.setReputation(
        reputation.address,
        reputation.opsSeen,
        reputation.opsIncluded
      );
    }
    return "ok";
  }

  async dumpReputation(): Promise<ReputationEntryDump[]> {
    return await this.reputationService.dump();
  }
}
