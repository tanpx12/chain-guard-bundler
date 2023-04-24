import { NETWORK_NAME_TO_CHAIN_ID, NetworkName } from "./types/networks";
import { IDbController } from "./types/db";
import { Executor } from "./executor";
import { Config } from "./common/config";
import { BundlerRPCMethods, CustomRPCMethods } from "./constants";
import { deepHexlify } from "./utils";
import { FastifyInstance, RouteHandler } from "fastify";
import logger from "./logger";
import cors from "@fastify/cors";

export interface RpcHandlerOptions {
  network: NetworkName;
  db: IDbController;
  config: Config;
}

export interface BundlerOptions {
  server: FastifyInstance;
  config: Config;
  db: IDbController;
  testingMode: boolean;
}

export class ApiApp {
  private server: FastifyInstance;
  private config: Config;
  private db: IDbController;
  private executors: Executor[] = [];
  private testingMode = false;

  constructor(options: BundlerOptions) {
    this.server = options.server;
    this.config = options.config;
    this.db = options.db;
    this.testingMode = options.testingMode;
    this.setupRoutes();
  }

  private setupRoutes(): void {
    if (this.testingMode) {
      this.server.post("/rpc/", this.setupRouteFor("dev"));
      logger.info("Setup route for dev: /rpc/");
      return;
    }
    const networkNames: NetworkName[] = this.config.supportedNetworks;
    for (const network of networkNames) {
      const chainId: number | undefined = NETWORK_NAME_TO_CHAIN_ID[network];
      if (chainId == undefined) {
        continue;
      }

      this.server.post(`/${chainId}`, this.setupRouteFor(network));
      logger.info(`Setup route for ${network}:/${chainId}/`);
    }
  }

  private setupRouteFor(network: NetworkName): RouteHandler {
    const executor = new Executor({
      network,
      db: this.db,
      config: this.config,
      logger: logger,
    });
    this.executors.push(executor);

    return async (req, res): Promise<void> => {
      let result: any = undefined;
      const { method, params, jsonrpc, id } = req.body as any;
      switch (method) {
        case BundlerRPCMethods.debug_bundler_setBundlingMode:
          result = await executor.debug.setBundlingMode(params[0]);
          break;
        case BundlerRPCMethods.debug_bundler_setBundleInterval:
          result = await executor.debug.setbundlingInterval(params[0]);
          break;
        case BundlerRPCMethods.debug_bundler_clearState:
          result = await executor.debug.clearState();
          break;
        case BundlerRPCMethods.debug_bundler_dumpMempool:
          console.log(method);

          result = await executor.debug.dumpMempool();
          break;
        case BundlerRPCMethods.debug_bundler_setReputation:
          result = await executor.debug.setReputation({
            reputations: params[0],
            entryPoint: params[1],
          });
          break;
        case BundlerRPCMethods.debug_bundler_dumpReputation:
          result = await executor.debug.dumpReputation();
          break;
        case BundlerRPCMethods.debug_bundler_sendBundleNow:
          result = await executor.debug.sendBundleNow();
          break;
      }

      if (result === undefined) {
        switch (method) {
          case BundlerRPCMethods.eth_supportedEntryPoints:
            result = await executor.eth.getSupportedEntryPoints();
            break;
          case BundlerRPCMethods.eth_chainId:
            console.log(method);

            result = await executor.eth.getChainId();
            break;
          case BundlerRPCMethods.eth_sendUserOperation:
            result = await executor.eth.sendUserOperation({
              userOp: params[0],
              entryPoint: params[1],
            });
            break;
          case CustomRPCMethods.eth_validateUserOperation:
            result = await executor.eth.validateUserOp({
              userOp: params[0],
              entryPoint: params[1],
            });
            break;
          case BundlerRPCMethods.eth_estimateUserOperationGas:
            result = await executor.eth.estimateUserOperationGas({
              userOp: params[0],
              entryPoint: params[1],
            });
            break;
          case BundlerRPCMethods.eth_getUserOperationByHash:
            result = await executor.eth.getUserOperationByHash(params[0]);
            break;
          case BundlerRPCMethods.eth_getUserOperationReceipt:
            result = await executor.eth.getUserOperationReceipt(params[0]);
            break;
        }
      }

      result = deepHexlify(result);
      return res.status(200).send({
        jsonrpc,
        id,
        result,
      });
    };
  }
}
