import { BigNumberish } from "ethers";
import { NetworkName } from "../networks";

export type ExecutorOptions = {
  [network in NetworkName]?: {
    entryPoints: string[];
    relayer: string;
    beneficiary: string;
    rpcEnpoint: string;
    minInclusiveDenominator?: number;
    throttlingSlack?: number;
    minSignerBalance?: BigNumberish;
    multicall?: string;
  };
};
