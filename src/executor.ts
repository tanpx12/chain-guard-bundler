import { BigNumber, providers } from "ethers";
import { NETWORK_NAME_TO_CHAIN_ID, NetworkName } from "./types/networks";
import { IDbController } from "./types/db";
import { NetworkConfig, Config } from "./common/config";
import { Debug, Eth } from "./modules/index";
import {
  MempoolService,
  ReputationService,
  UserOpValidationService,
  BundlingService,
} from "./services/index";
import { Logger } from "./models/ExecutorInterface";

export interface ExecutorOptions {
  network: NetworkName;
  db: IDbController;
  config: Config;
  logger: Logger;
}

export class Executor {
  private network: NetworkName;
  private networkConfig: NetworkConfig;
  private logger: Logger;

  public config: Config;
  public provider: providers.JsonRpcProvider;

  public debug: Debug;
  public eth: Eth;

  public bundlingService: BundlingService;
  public mempoolService: MempoolService;
  public reputationService: ReputationService;
  public userOpValidationService: UserOpValidationService;

  private db: IDbController;

  constructor(options: ExecutorOptions) {
    console.log(options.network);
    this.db = options.db;
    this.network = options.network;
    this.config = options.config;
    this.logger = options.logger;
    this.networkConfig = options.config.networks[
      options.network
    ] as NetworkConfig;
    this.provider = this.config.getNetworkProvider(
      this.network
    ) as providers.JsonRpcProvider;
    const chainId = Number(NETWORK_NAME_TO_CHAIN_ID[this.network]);
    this.reputationService = new ReputationService(
      this.db,
      chainId,
      this.networkConfig.minInclusionDenominator,
      this.networkConfig.throttlingSlack,
      this.networkConfig.banSlack,
      BigNumber.from(1),
      0
    );
    this.userOpValidationService = new UserOpValidationService(
      this.provider,
      this.reputationService,
      this.network
    );

    this.mempoolService = new MempoolService(
      this.db,
      chainId,
      this.reputationService
    );

    this.bundlingService = new BundlingService(
      this.network,
      this.provider,
      this.mempoolService,
      this.userOpValidationService,
      this.reputationService,
      this.config,
      this.logger
    );

    this.debug = new Debug(
      this.provider,
      this.bundlingService,
      this.mempoolService,
      this.reputationService
    );

    this.eth = new Eth(
      this.provider,
      this.userOpValidationService,
      this.mempoolService,
      this.networkConfig,
      this.logger
    );
  }
}
