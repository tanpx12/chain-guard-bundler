# Overview
## Setup

- Install all dependencies of this repo
- Create folder `rocksDb/test` in the root of this folder
- Create `./src/common/globalConfig.ts` file with `./src/common/globalConfig.example.ts` template
- Run `ts-node src/app.ts`

## Descriptions
This is a simple implementation of account abstraction bundler. This implementation use JSON RPC format with the following options:

- `eth_sendUserOperation`: submits a User Operation object to the User Operation pool of the client. The client MUST validate the UserOperation, and return a result accordingly.

- `eth_estimateUserOperationGas`: Estimate the gas values for a UserOperation. Given UserOperation optionally without gas limits and gas prices, return the needed gas limits. The signature field is ignored by the wallet, so that the operation will not require user’s approval.

- `eth_getUserOperationByHash`: Return a UserOperation based on a hash (userOpHash) returned by `eth_sendUserOperation`

- `eth_getUserOperationReceipt`: Return a UserOperation receipt based on a hash (userOpHash) returned by `eth_sendUserOperation`

- `eth_supportedEntryPoints`: Returns a list of the entryPoint addresses supported by the client. The first element of the array SHOULD be the entryPoint addressed preferred by the client.

- `eth_chainId`: Returns `EIP-155` Chain ID.

- `debug_bundler_clearState`: Clears the bundler mempool and reputation data of paymasters/accounts/factories/aggregators.

- `debug_bundler_dumpMempool`: Dumps the current UserOperations mempool

- `debug_bundler_sendBundleNow`: Forces the bundler to build and execute a bundle from the mempool as `handleOps()` transaction.

- `debug_bundler_setBundlingMode`: Sets bundling mode. After setting mode to “manual”, an explicit call to debug_bundler_sendBundleNow is required to send a bundle.

- `debug_bundler_setReputation`: Sets reputation of given addresses.

- `debug_bundler_dumpReputation`: Returns the reputation data of all observed addresses.

# Methods
## eth_sendUserOperation

``` 
// Request 
{
	"jsonrpc": "2.0",
	"id": 1,
	"method": "eth_sendUserOperation",
	"params": [{
	sender, // address
      	nonce, // uint256
      	initCode, // bytes
      	callData, // bytes
      	callGasLimit, // uint256
      	verificationGasLimit, // uint256
      	preVerificationGas, // uint256
      	maxFeePerGas, // uint256
      	maxPriorityFeePerGas, // uint256
      	paymasterAndData, // bytes
      	signature // bytes
    	},
    	entryPoint // address]
}

// Response
{
	"jsonrpc": "2.0",
	"id": 1,
	"result": "ok",
	"userOpHash": "123..."
}
```

## eth_estimateUserOperationGas 

```
// Request
{
	"jsonrpc" : "2.0",
	"id" : 1,
	"method": "eth_estimateUserOperationGas",
	"params":[{
      sender, // address
      nonce, // uint256
      initCode, // bytes
      callData, // bytes
      callGasLimit, // uint256
      verificationGasLimit, // uint256
      preVerificationGas, // uint256
      maxFeePerGas, // uint256
      maxPriorityFeePerGas, // uint256
      paymasterAndData, // bytes
      signature // bytes
    },
    entryPoint // address]
}

// Response
{
	"jsonrpc": "2.0",
	"id": 1,
	"result": "ok",
	"preverificationGas": ...,
	"verificationGas": ...,
	"callGasLimit":...,
	"deadline":...,
}
```

## eth_getUserOperationByHash

```
// Request 
{
	"jsonrpc" : "2.0",
	"id" : 1,
	"method": "eth_getUserOperationByHash",
	"params": [userOpHash],
}

// Response
{
	"jsonrpc": "2.0",
	"id": 1,
	"result": "ok",
	"userOperation": {...},
	"entryPoint": ...,
	"transactionHash": ...,
	"blockHash": ...,
	"blockNumber": ...
}
```

## eth_getUserOperationReceipt

```
// Request
{
	"jsonrpc": "2.0",
	"id": 1,
	"method": "eth_getUserOperationReceipt",
	"params": [userOpHash]
}
// Response
{
	"jsonrpc": "2.0",
	"id": 1,
	"result": "ok",
	"userOpHash": ...,
	"sender": ...,
	"nonce": ...,
	"actualGasCost": ...,
	"actualGasUsed": ...,
	"success": ...,
	"logs": ...,
	"receipt": ...,
}
```

## eth_supportedEntryPoints

``` 
// Request
{
	"jsonrpc": "2.0",
	"id": 1,
	"method": "eth_supportedEntryPoints",
	"params": null
}

// Response
{
	"jsonrpc": "2.0",
	"id": 1,
	"result": "ok",
	"supportedEntryPoints": []	
}
```

## eth_chainId

```
// Request
{
	"jsonrpc": "2.0",
	"id": 1,
	"method": "eth_chainId",
	"params": null
}

// Response
{
	"jsonrpc": "2.0",
	"id": 1,
	"result": "ok",
	"chainId": ...	
}
```
