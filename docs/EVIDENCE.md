# LEMO evidence map

This file maps every claim in the README to a file, a command and an observed result. A claim without an artifact is not a claim.

Snapshot: 2026-11-02. Four support contracts are deployed on Portaldot V3; the native registry is not.

## Live deployments

| Contract | Address | Mapped account (scanner) | Deploy extrinsic (scanner) | Cost |
|---|---|---|---|---|
| `ReviveBlake2b256` | `0x15ae34fa8fd933d6d4e1cf9a772b305f0abc7e22` | [5CZ8cW…Sani](https://scanner-testnet-v3.portaldot.dev/#/accounts/5CZ8cWRiFMjyLbQwhAMiJdJ9RLyTw3YJjjZy2vCXM1vdSani) | [294148-1](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/294148-1) | 71.78 tPOT |
| `RootFeed` (attester `0x884f…aBf7`) | `0xc1c95be2f38f865438f684d269f340f5c505d5c0` | [5GSnv2…5fdY](https://scanner-testnet-v3.portaldot.dev/#/accounts/5GSnv2LBRuf7hikmh39R8ws5qwi6moH6AGgHTSeRykGC5fdY) | [294249-1](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/294249-1) | 139.16 tPOT |
| `SubstrateTrieVerifier` | `0xe5ca668667d3e2c8a0272ee4e446d6aa88a86bac` | [5HFzwx…twGw](https://scanner-testnet-v3.portaldot.dev/#/accounts/5HFzwxCtJFj8q7eETYTqFxdG2wnEwJCdLVBHpeYEivwitwGw) | [294498-1](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/294498-1) | 666.15 tPOT |
| `TitleGateERC20` | `0xfbefe3cbf0785b3d08814eb02a348c9ca296741f` | [5Hm38y…9EJf](https://scanner-testnet-v3.portaldot.dev/#/accounts/5Hm38ynRjaM2qRdje35XJbD6CsYcAXX1TEuHcwub7ju69EJf) | [294503-1](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/294503-1) | 500.98 tPOT |
All four were deployed through `revive.instantiateWithCode` from the native SS58 account [`5GEXs8zz7giva7C2FcoLmTM4TgH6HgzSPZF7Qzj8n742tiVx`](https://scanner-testnet-v3.portaldot.dev/#/accounts/5GEXs8zz7giva7C2FcoLmTM4TgH6HgzSPZF7Qzj8n742tiVx). The extrinsic ids are signed native extrinsics and open on the Portaldot V3 scanner; each mapped account (`H160 ++ 0xEE*12`) shows the code deposit reserved against the contract (the gate's reads 134.022 tPOT reserved). An earlier version of this table listed hashes that are not extrinsic hashes; they were replaced with the scanner ids above. The root attested at block [#294515](https://scanner-testnet-v3.portaldot.dev/#/blocks/294515) is that block's state root on the scanner (`0x19ff…8b80`). The pause is EVM transaction `0xfc7f…05bf`, an unsigned `revive.ethTransact` at index 2 of block [#294761](https://scanner-testnet-v3.portaldot.dev/#/blocks/294761); the scanner lists signed extrinsics only, so EVM transactions link to their block. `0xc1c9…d5c0` reads `attester() = 0x884fe7b4Df96D257c23c2DB2077a511C4db2aBf7`, `currentRoot() = 0x19ff4a2de31211f1fc6d508ba7ddbd23477ed289bc804dc826f0fa2b99898b80`, `live() = true`; the root was attested at finalized block 294515. The gate reads `owner = 0x884f…aBf7`, `verifier = 0xe5ca…6bAc`, `feed = 0xc1c9…d5c0`, `titleId = 0x1c6d…1db7`, `titleCommitment = 0x3a22…6cda`, `paused = true` after `0xfc7fb72e7c56c9e723dbc03032a06e82ad018174f22f12559a364502245a05bf`. The remaining native balance is 153.39 tPOT. The live gate bytecode predates the holder-only burn fix in source; it must be redeployed before live use.

## Gates

| Gate | Command | Observed |
|---|---|---|
| Site and console build | `npm run build` | Pass, 7 routes prerendered |
| TypeScript | `npx tsc --noEmit` | Pass |
| Lint | `npx oxlint` | 0 errors, warnings listed in the audit |
| Proof service | `cd server && npx tsc --noEmit && npm test` | Pass, 1,077 tests |
| Stress suite | inside `npm test` | 1,019 deterministic cases, seed 20261102 |
| Contracts | `export PATH=$PATH:$HOME/.foundry/bin && forge test` | 90 passed, 0 failed |
| Native pallet | `cd pallets/lemo-title && cargo test` | 10 passed, 0 failed |
| Live chain reads | `curl` / console | PortaldotV3 Test, chain id 420420777 |
| Statement Store | WebSocket `statement_subscribeStatement ["any"]` | Accepted, subscription id returned |

## The live proof

| Field | Value | Source |
|---|---|---|
| Network | Portaldot V3 testnet | `system_chain` |
| EVM chain id | 420420777 | `eth_chainId` |
| Finalized block | 292863 | `chain_getHeader` at `chain_getFinalizedHead` |
| State root | `0x90d67ea567eb62e8df58d4bed6f0e66329f547ad75be215caa66f4abde60cbe5` | finalized header |
| Storage key | `0x26aa394eea5630e07c48ae0c9558cef702a5c1b19ab7a04f536c519aca4983ac` | twox128("System") ++ twox128("Number") |
| Storage value | `0xff770400` | `state_getStorage` at the same hash |
| Decoded value | 292863 | little-endian u32 |
| Proof | 4 nodes, 47 / 168 / 498 / 290 bytes | `state_getReadProof` |
| TypeScript verdict | present, value matches storage | `server/src/proofs/trie.ts`, `lib/proofs.ts` |
| Solidity verdict (contract fixture, block 292815) | present, value `0xcf770400` | `test/SubstrateTrieVerifier.t.sol` |

The service fixture is committed at `server/test/fixtures/portaldot-v3.json`; the contract fixture is at `test/fixtures/system-number-292815.json`. Both suites verify without a network.

## Acceptance criteria

| # | Criterion | State | Evidence | What is missing |
|---|---|---|---|---|
| 1 | Create a title with real native backing on Portaldot V3 | Not done | No deployment artifact | A deployed native registry and a backing escrow |
| 2 | Establish its ERC-20 or ERC-721 representation | Tested; gate deployed, no real title proof | `contracts/TitleGateERC20.sol`, `test/TitleGate.t.sol`, gate `0xfbef…741f` | A native title record and its proof; the gate commitment is a placeholder |
| 3 | Verify native state from EVM with a real finalized proof | Tested; verifier deployed | `contracts/SubstrateTrieVerifier.sol`, verifier `0xe5ca…6bAc`, live fixture test | A real title record under the feed root; the production root is a trusted checkpoint |
| 4 | Verify EVM state from native with a real finalized proof | Blocked | No native contract runtime on V3 testnet | The WASM contracts module and a native EVM proof verifier |
| 5 | Reject transfers after native identity is cleared | Tested | `test_RevertOnClearedIdentity` | On-chain title state |
| 6 | Reject transfers after native backing is unbound | Tested | `test_RevertOnUnboundBacking` | On-chain title state |
| 7 | Reject stale or replayed proofs | Tested | `test_RevertOnStaleRoot`, `test_RevertOnReplayedProof`, `test_RevertOnOldRevision` | Deployment |
| 8 | Reject native unbond while ERC-20 supply is outstanding on-chain | Logic tested, `UnbondGuard` not deployed | `contracts/UnbondGuard.sol` | Deploy the guard and enforce the check in the native runtime |
| 9 | Reject native unbond while an ERC-721 is outstanding on-chain | Logic tested, `UnbondGuard` not deployed | `contracts/UnbondGuard.sol` | Deploy the guard and enforce the check in the native runtime |
| 10 | Demonstrate redemption and native unlock | Not done | Burn and guard paths exist in tests | A deployed pair and a native unlock path |
| 11 | Interrupted transitions cannot create unbacked tokens | Tested | `test/FailureInjection.t.sol`, gate tests | A deployed system |
| 12 | Discovery through supported gossip, never authoritative | Transport verified, publication not wired | WebSocket subscription to `any`; `statement_submit` present | A signed announcement publisher and a non-authoritative reader |
| 13 | Full lifecycle on the actual V3 testnet | Not done | No deployment artifact | Everything above |

## What the tests do not prove

- They do not prove a deployed system. The hasher, verifier, root feed and gate are live; there is no native title record or deployed `UnbondGuard`.
- They do not prove the native side can enforce Rule 2. The WASM contract module is not live.
- They do not prove the root came from the canonical chain. `RootFeed` is an attested checkpoint, not a light client.
- They do not cover an independent external audit. `docs/AUDIT.md` is a self-audit, not a third-party sign-off.
- The EVM endpoint's `eth_getProof` refusal is a fact about this public node, not a proof that no Revive node can ever serve account proofs.

## Reproduction

```bash
# Site and console
npm run build

# Proof service
cd server
npx tsc --noEmit
npm test

# Contracts
export PATH=$PATH:$HOME/.foundry/bin
forge build
forge test

# Live reads
curl -s -X POST https://test-node-v3.portaldot.dev \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"system_chain","params":[]}'

curl -s -X POST https://test-evm-rpc-v3.portaldot.dev \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
```

The public endpoints drop connections above a small concurrency ceiling. Reads in the site and service go through a serialized queue with retries.
