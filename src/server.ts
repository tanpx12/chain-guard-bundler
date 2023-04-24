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
import cors from "@fastify/cors";

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
        entryPoints: [process.env.ENTRYPOINT as string],
        relayer: process.env.RELAYER as string,
        beneficiary: process.env.BENEFICIARY as string,
        name: "goerli",
        rpcEndpoint: "https://goerli.blockpi.network/v1/rpc/public",
        minInclusionDenominator: bundlerDefaultConfigs.minInclusionDenominator,
        throttlingSlack: bundlerDefaultConfigs.throttlingSlack,
        banSlack: bundlerDefaultConfigs.banSlack,
        minSignerBalance: bundlerDefaultConfigs.minSignerBalance,
        multicall: bundlerDefaultConfigs.multicall,
      },
      sepolia: {
        entryPoints: [process.env.ENTRYPOINT as string],
        relayer: process.env.RELAYER as string,
        beneficiary: process.env.BENEFICIARY as string,
        name: "sepolia",
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
  server.application.register(cors, {
    origin: "*",
    methods: ["POST"],
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
