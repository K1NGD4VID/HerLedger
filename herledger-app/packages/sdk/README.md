# @herledger/sdk

Typed client for HerLedger's Soroban contracts (`BusinessRegistry`, `FinancialLedger`,
`AttestationRegistry`), Freighter wallet integration, and Soroban RPC access with
multi-endpoint failover.

## Query caching

Read-only contract calls (`getBusiness`, `getBusinessByWallet`, `getFinancialEvent`,
`getBusinessEvents`, `isSupportedAsset`, `getAttestation`, `isValidAttestation`) are
served through an in-memory TTL cache (`packages/sdk/src/cache/query-cache.ts`):

- **De-duplication**: concurrent identical calls (same contract id + method + args)
  share a single in-flight RPC request instead of issuing one each.
- **TTL**: cached results expire after `ttlMs`, which defaults to **30 seconds**.
  Override per call: `getBusiness(id, config, contracts, { ttlMs: 5_000 })`.
- **Opt-out**: pass `{ bypassCache: true }` to force a fresh RPC call for that
  invocation.
- **Mutation invalidation**: write functions (`registerBusiness`,
  `updateBusinessMetadata`, `recordFinancialEvent`, `createAttestation`, ...)
  invalidate the cache entries their contract method affects after a successful
  `submitAndWait`, so a read immediately after a write does not see a stale value.
- **Manual control**: `clearQueryCache()` clears everything (handy in tests);
  `defaultQueryCache.invalidate(key)` / `.clear()` are also exported for
  advanced use, along with the `QueryCache` class itself if you want a
  separate, non-shared cache instance.

**Why a module-level singleton is safe under SSR/Edge**: cached values are
read-only, publicly observable contract state — the answer to "what is
business X" is the same no matter which request or user asked. Sharing the
cache across concurrent requests in the same process/isolate is what enables
de-duplication; it introduces no per-user data leakage, and the default 30s
TTL bounds any staleness from sharing across requests. Serverless/Edge
runtimes spin up a fresh module instance (and therefore an empty cache) per
isolate, so there's no risk of a *durable* cross-deployment cache. Callers
needing hard per-request isolation can construct their own `new QueryCache()`
or pass `{ bypassCache: true }`.

## RPC timeouts

`simulateAndPrepare` and `submitAndWait` (`packages/sdk/src/rpc/transactions.ts`)
accept an optional third argument:

```ts
simulateAndPrepare(tx, config, { timeoutMs: 10_000 });
simulateAndPrepare(tx, config, { signal: myAbortController.signal });
```

- `timeoutMs` defaults to **30 000ms**.
- A timed-out call, or one whose `signal` fires, rejects with `RpcError` whose
  `code` is `"TIMEOUT"`.
- `submitAndWait`'s confirmation poll loop (which can legitimately run longer
  than a single RPC call's deadline) additionally checks `signal` between
  polls, so an aborted signal stops polling early even though it isn't itself
  bounded by `timeoutMs`.

Both parameters are optional and additive — existing two-argument call sites
are unaffected.

## Error hierarchy

Every SDK error extends `Error` and carries:

- `code` — a `string` enum specific to that error class (see tables below).
- `context` — an optional, class-specific typed payload with structured
  detail (e.g. `{ timeoutMs }`, `{ contractCode, method }`).
- `cause` — the underlying error/value, if any (standard `Error.cause`).

```ts
import { RpcError, RpcErrorCode, assertUnreachable, type AppError } from "@herledger/sdk";

function handle(error: AppError) {
  switch (error.kind) {
    case "WalletError":
      /* ... */ break;
    case "RpcError":
      switch (error.code) {
        case RpcErrorCode.TIMEOUT:
          /* retry */ break;
        case RpcErrorCode.ALL_ENDPOINTS_UNAVAILABLE:
        case RpcErrorCode.NO_ENDPOINTS_CONFIGURED:
        case RpcErrorCode.REQUEST_FAILED:
        case RpcErrorCode.TRANSACTION_NOT_CONFIRMED:
          /* surface to user */ break;
      }
      break;
    case "ContractError":
    case "ValidationError":
    case "AuthenticationError":
      /* ... */ break;
    default:
      return assertUnreachable(error);
  }
}
```

`assertUnreachable` makes the `default` branch a compile error if a new
`AppError` subtype is ever added without being handled.

### Error codes

**`WalletError`** (`WalletErrorCode`): `NOT_INSTALLED`, `ACCESS_DENIED`,
`SIGNING_REJECTED`, `ADDRESS_UNAVAILABLE`, `UNAVAILABLE`, `UNKNOWN`.

**`RpcError`** (`RpcErrorCode`): `REQUEST_FAILED`, `TIMEOUT`,
`ALL_ENDPOINTS_UNAVAILABLE`, `NO_ENDPOINTS_CONFIGURED`,
`TRANSACTION_NOT_CONFIRMED`.

**`ContractError`** (`ContractErrorCode`): `SIMULATION_ERROR`,
`SUBMISSION_ERROR`, `ON_CHAIN_FAILURE`, `DECODE_ERROR`, `ENCODE_ERROR`,
`UNKNOWN_VARIANT`.

**`ValidationError`** (`ValidationErrorCode`): `MALFORMED_INPUT`,
`ADDRESS_NOT_REGISTERED`, `ADDRESS_MISMATCH`.

**`AuthenticationError`** (`AuthenticationErrorCode`): `UNAUTHENTICATED`,
`FORBIDDEN`, `SESSION_EXPIRED` — reserved for callers layering authentication
on top of the SDK; the SDK itself does not currently throw this error.

See `packages/sdk/src/errors/index.ts` for the full JSDoc on each code and
context shape.
