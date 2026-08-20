import { rpc as StellarRpc, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import type { StellarNetworkConfig, TransactionResult } from "../types/index.js";
import { RpcError, RpcErrorCode, ContractError, ContractErrorCode } from "../errors/index.js";
import { getSorobanRpcServer } from "./client.js";
import { withRpcTimeout, type RpcCallOptions } from "./timeout.js";

export type { RpcCallOptions } from "./timeout.js";

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 30;

/**
 * Simulate a transaction and return the prepared transaction with
 * the resource footprint and fee populated from the simulation result.
 *
 * @param options Optional `{ signal, timeoutMs }`. Defaults to a 30s
 * deadline; a timed-out or aborted call throws `RpcError` with
 * `code: "TIMEOUT"`.
 */
export async function simulateAndPrepare(
  tx: Transaction,
  config: StellarNetworkConfig,
  options?: RpcCallOptions
): Promise<Transaction> {
  const server = getSorobanRpcServer(config);
  let simResult: StellarRpc.Api.SimulateTransactionResponse;
  try {
    simResult = await withRpcTimeout(server.simulateTransaction(tx), options);
  } catch (cause) {
    if (cause instanceof RpcError) throw cause;
    throw new RpcError(RpcErrorCode.REQUEST_FAILED, "Transaction simulation failed", { cause });
  }

  if (StellarRpc.Api.isSimulationError(simResult)) {
    throw new ContractError(
      ContractErrorCode.SIMULATION_ERROR,
      `Simulation error: ${simResult.error}`,
      { context: { contractCode: simResult.error } }
    );
  }

  const prepared = StellarRpc.assembleTransaction(tx, simResult).build();
  return prepared as unknown as Transaction;
}

/**
 * Submit a signed transaction XDR and poll until confirmed or failed.
 *
 * @param options Optional `{ signal, timeoutMs }`. `timeoutMs` (default 30s)
 * bounds the initial submission call; a timed-out or aborted submission
 * throws `RpcError` with `code: "TIMEOUT"`. The confirmation poll loop
 * additionally checks `signal` between polls so an aborted signal also
 * stops polling early (it is not itself bounded by `timeoutMs`, since
 * on-chain confirmation can legitimately take longer than a single RPC
 * call's deadline).
 */
export async function submitAndWait(
  signedXdr: string,
  config: StellarNetworkConfig,
  options?: RpcCallOptions
): Promise<TransactionResult> {
  const server = getSorobanRpcServer(config);

  // Parse the XDR back into a transaction object for submission
  const txObj = TransactionBuilder.fromXDR(signedXdr, config.networkPassphrase);

  let sendResult: StellarRpc.Api.SendTransactionResponse;
  try {
    sendResult = await withRpcTimeout(server.sendTransaction(txObj), options);
  } catch (cause) {
    if (cause instanceof RpcError) throw cause;
    throw new RpcError(RpcErrorCode.REQUEST_FAILED, "Failed to submit transaction", { cause });
  }

  if (sendResult.status === "ERROR") {
    const detail = sendResult.errorResult?.toXDR("base64") ?? "unknown";
    throw new ContractError(
      ContractErrorCode.SUBMISSION_ERROR,
      `Transaction submission error: ${detail}`,
      { context: { contractCode: sendResult.status } }
    );
  }

  const hash = sendResult.hash;

  for (let i = 0; i < MAX_POLLS; i++) {
    if (options?.signal?.aborted) {
      throw new RpcError(RpcErrorCode.TIMEOUT, `Polling for transaction ${hash} was aborted`, {
        context: { hash },
      });
    }

    await sleep(POLL_INTERVAL_MS);
    let getResult: StellarRpc.Api.GetTransactionResponse;
    try {
      getResult = await server.getTransaction(hash);
    } catch (cause) {
      throw new RpcError(RpcErrorCode.REQUEST_FAILED, `Failed to poll transaction ${hash}`, {
        context: { hash },
        cause,
      });
    }

    if (getResult.status === StellarRpc.Api.GetTransactionStatus.SUCCESS) {
      return { hash, success: true, ledger: getResult.ledger };
    }
    if (getResult.status === StellarRpc.Api.GetTransactionStatus.FAILED) {
      throw new ContractError(
        ContractErrorCode.ON_CHAIN_FAILURE,
        `Transaction ${hash} failed on-chain`,
        { context: { contractCode: getResult.status } }
      );
    }
    // NOT_FOUND = still pending, keep polling
  }

  throw new RpcError(
    RpcErrorCode.TRANSACTION_NOT_CONFIRMED,
    `Transaction ${hash} did not confirm within timeout`,
    { context: { hash } }
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
