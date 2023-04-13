import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fastify, { FastifyInstance } from "fastify";
import RpcError from "./types/api/errors/rpc-error";
import { ServerConfig } from "./types/api/interfaces";
import logger from "./logger";
import { ApiApp } from "./app";
import { Config, bundlerDefaultConfigs } from "./common/config";
import { IDbController } from "./types/db";
import { RocksDbController } from "./db/rocksDb";

class Server {
  private app: FastifyInstance;
  constructor(private config: ServerConfig) {
    this.app = fastify({
      logger,
      disableRequestLogging: !config.enableRequestLogging,
      ignoreTrailingSlash: true,
    });
    this.app.addHook("preHandler", (req, reply, done) => {
      if (req.method === "POST") {
        req.log.info(
          {
            method: req.method,
            url: req.url,
            body: req.body,
          },
          "REQUEST ::"
        );
      } else {
        req.log.info(
          {
            method: req.method,
            url: req.url,
          },
          "REQUEST ::"
        );
      }
      done();
    });

    this.app.addHook("preSerialization", (req, reply, payload, done) => {
      if (payload) {
        req.log.info({ body: payload }, "RESPONSE ::");
      }
      done();
    });
  }

  listen(): void {
    this.app.setErrorHandler((err, req, res) => {
      logger.error(err);
      if (err instanceof RpcError) {
        const body = req.body as any;
        const error = {
          message: err.message,
          data: err.data,
          code: err.code,
        };
        return res.status(200).send({
          jsonrpc: body.jsonrpc,
          id: body.id,
          error,
        });
      }
      return res
        .status(err.statusCode ?? 500)
        .send({ error: "Unexpeceted behavior" });
    });

    void this.app.listen({
      port: this.config.port,
      host: this.config.host,
    });
  }

  get application(): FastifyInstance {
    return this.app;
  }
}

async function main() {
  let db: IDbController = new RocksDbController("rocksDb", "test");
  await db.start();
  const config = new Config({
    networks: {
      goerli: {
        entryPoints: ["0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"],
        relayer:
          "1a13367d464992133bcd429baad47e352f467d2ff58c676b6f11c7ca0a21c698",
        beneficiary: "0x242ed78bF0FE7672FF01AE6dE558E45B3749f197",
        name: "goerli",
        rpcEndpoint: "https://goerli.blockpi.network/v1/rpc/public",
        minInclusionDenominator: bundlerDefaultConfigs.minInclusionDenominator,
        throttlingSlack: bundlerDefaultConfigs.throttlingSlack,
        banSlack: bundlerDefaultConfigs.banSlack,
        minSignerBalance: bundlerDefaultConfigs.minSignerBalance,
        multicall: bundlerDefaultConfigs.multicall,
      },
      sepolia: {
        entryPoints: ["0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"],
        relayer:
          "1a13367d464992133bcd429baad47e352f467d2ff58c676b6f11c7ca0a21c698",
        beneficiary: "0x242ed78bF0FE7672FF01AE6dE558E45B3749f197",
        name: "goerli",
        rpcEndpoint: "https://rpc.sepolia.org",
        minInclusionDenominator: bundlerDefaultConfigs.minInclusionDenominator,
        throttlingSlack: bundlerDefaultConfigs.throttlingSlack,
        banSlack: bundlerDefaultConfigs.banSlack,
        minSignerBalance: bundlerDefaultConfigs.minSignerBalance,
        multicall: bundlerDefaultConfigs.multicall,
      },
    },
    testingMode: true,
  });
  const server = new Server({
    enableRequestLogging: true,
    port: 5000,
    host: "localhost",
  });

  new ApiApp({
    server: server.application,
    config: config,
    db: db,
    testingMode: false,
  });
  server.listen();
}

main();
