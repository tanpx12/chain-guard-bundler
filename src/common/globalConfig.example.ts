import { bundlerDefaultConfigs, Config } from "./config";
export const globalConfig = new Config({
  networks: {
    goerli: {
      entryPoints: ["0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"],
      relayer: "<<relayer-prv-key>>",
      beneficiary: "<<relayer-address>>",
      name: "goerli",
      rpcEndpoint: "<<rpc-endpoint-url>>",
      minInclusionDenominator: bundlerDefaultConfigs.minInclusionDenominator,
      throttlingSlack: bundlerDefaultConfigs.throttlingSlack,
      banSlack: bundlerDefaultConfigs.banSlack,
      minSignerBalance: bundlerDefaultConfigs.minSignerBalance,
      multicall: bundlerDefaultConfigs.multicall,
    },
    sepolia: {
      entryPoints: ["0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"],
      relayer: "<<relayer-prv-key>>",
      beneficiary: "<<relayer-address>>",
      name: "sepolia",
      rpcEndpoint: "<<rpc-endpoint-url>>",
      minInclusionDenominator: bundlerDefaultConfigs.minInclusionDenominator,
      throttlingSlack: bundlerDefaultConfigs.throttlingSlack,
      banSlack: bundlerDefaultConfigs.banSlack,
      minSignerBalance: bundlerDefaultConfigs.minSignerBalance,
      multicall: bundlerDefaultConfigs.multicall,
    },
  },
  testingMode: true,
});
