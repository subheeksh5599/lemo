# LEMO evidence map

This file maps every claim in the README to a file, a command and an observed result. A claim without an artifact is not a claim.

Snapshot: 2026-11-02. Two support contracts are deployed on Portaldot V3; the gate and verifier are not.

## Live deployments

| Contract | Address | Transaction | Cost |
|---|---|---|---|
| `ReviveBlake2b256` | `0x15ae34fa8fd933d6d4e1cf9a772b305f0abc7e22` | `0x49d84833987b685ef1ab449920ee126e101f9e85945fb9a05ee444097af93c8d` | 71.78 tPOT |
| `RootFeed` (attester `0x884f…aBf7`) | `0xc1c95be2f38f865438f684d269f340f5c505d5c0` | `0x4cc848b73cca15788b6cb3d843526978c80fc02fb1e523bed921a71cc9d2328b` | 139.16 tPOT |

Both were deployed through `revive.instantiateWithCode` from the native SS58 account `5GEXs8zz7giva7C2FcoLmTM4TgH6HgzSPZF7Qzj8n742tiVx`; `0xc1c9…d5c0` reads `attester() = 0x884fe7b4Df96D257c23c2DB2077a511C4db2aBf7`, `currentRoot() = 0`, `live() = false`. The remaining native balance is 320.51 tPOT. The verifier (~675 tPOT) and ERC-20 gate (~600 tPOT) do not fit.

## Gates

| Gate | Command | Observed |
|---|---|---|
| Site and console build | `npm run build` | Pass, 7 routes prerendered |
| TypeScript | `npx tsc --noEmit` | Pass |
| Lint | `npx oxlint` | 0 errors, warnings listed in the audit |
| Proof service | `cd server && npx tsc --noEmit && npm test` | Pass, 1,077 tests |
| Stress suite | inside `npm test` | 1,019 deterministic cases, seed 20261102 |
| Contracts | `export PATH=$PATH:$HOME/.foundry/bin && forge test` | 86 passed, 0 failed |
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
| 2 | Establish its ERC-20 or ERC-721 representation | Tested, not deployed | `contracts/TitleGateERC20.sol`, `TitleGateERC721.sol`, `test/TitleGate.t.sol` | A gate deployment; the hasher and root feed are live, the gate is not |
| 3 | Verify native state from EVM with a real finalized proof | Tested | `contracts/SubstrateTrieVerifier.sol`, live fixture test | Deployment and a production root feed |
| 4 | Verify EVM state from native with a real finalized proof | Blocked | No native contract runtime on V3 testnet | The WASM contracts module and a native EVM proof verifier |
| 5 | Reject transfers after native identity is cleared | Tested | `test_RevertOnClearedIdentity` | On-chain title state |
| 6 | Reject transfers after native backing is unbound | Tested | `test_RevertOnUnboundBacking` | On-chain title state |
| 7 | Reject stale or replayed proofs | Tested | `test_RevertOnStaleRoot`, `test_RevertOnReplayedProof`, `test_RevertOnOldRevision` | Deployment |
| 8 | Reject native unbond while ERC-20 supply is outstanding on-chain | Logic tested, not enforced | `contracts/UnbondGuard.sol` | Native runtime enforcement |
| 9 | Reject native unbond while an ERC-721 is outstanding on-chain | Logic tested, not enforced | `contracts/UnbondGuard.sol` | Native runtime enforcement |
| 10 | Demonstrate redemption and native unlock | Not done | Burn and guard paths exist in tests | A deployed pair and a native unlock path |
| 11 | Interrupted transitions cannot create unbacked tokens | Tested | `test/FailureInjection.t.sol`, gate tests | A deployed system |
| 12 | Discovery through supported gossip, never authoritative | Transport verified, publication not wired | WebSocket subscription to `any`; `statement_submit` present | A signed announcement publisher and a non-authoritative reader |
| 13 | Full lifecycle on the actual V3 testnet | Not done | No deployment artifact | Everything above |

## What the tests do not prove

- They do not prove a deployed system. The hasher and root feed are live, but there is no gate or verifier address.
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
