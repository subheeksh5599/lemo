<div align="center">

# LEMO

### One asset. Two rooms. One title both rooms must obey.

[![live](https://img.shields.io/badge/live-lemo--ebon.vercel.app-1c6cff?labelColor=0f1420)](https://lemo-ebon.vercel.app)
[![status](https://img.shields.io/badge/status-four%20contracts%20deployed-f59e0b?labelColor=0f1420)](#live-status)
[![contracts](https://img.shields.io/badge/forge-90%20passing-16a34a?labelColor=0f1420)](#tests)
[![pallet](https://img.shields.io/badge/pallet-10%20passing-16a34a?labelColor=0f1420)](#tests)
[![service](https://img.shields.io/badge/proof%20service-1%2C077%20passing-16a34a?labelColor=0f1420)](#tests)

[![chain](https://img.shields.io/badge/Portaldot%20V3-Revive%20420420777-2f6bff?labelColor=0f1420)](#live-status)
[![run](https://img.shields.io/badge/run%20it-one%20command-black)](#-see-it-in-one-command)
[![verify](https://img.shields.io/badge/verify-every%20claim-black)](#verify-every-claim-in-one-command)
[![honesty](https://img.shields.io/badge/honesty-table-black)](#whats-real-vs-pending--the-honesty-table)

</div>

Portaldot V3 has two ways to hold an asset. In the native room a title has an owner, backing, identity, vesting and permissions. In the Revive room an ERC-20 moves through Solidity. Both settle under the same finality, but they do not share storage.

A token can move in the Revive room while the native room has already released the backing that made it real.

LEMO is the title both rooms have to agree on. The native record is the legal room. The Revive token is the market room. The token asks for a finalized proof of the native title before it moves, and the native side refuses to release backing while a representation is still alive. The proof is not a server call and not a bridge message. It is a storage proof against a finalized state root, verified by the contract that is about to change state.

```text
native title record  ->  finalized state root  ->  storage proof  ->  EVM gate  ->  move
EVM representation   ->  outstanding supply    ->  native unbond  ->  refuse
```

## ▶ Demo video

The video is recorded by the owner. No recording is fabricated or embedded in this repository. The click-by-click script is [`docs/demo-script.md`](docs/demo-script.md), and the live site is the set.

The honest demo is read-only: live heads, a real Substrate proof, `eth_getProof` refusing, the key verifier, the network page, the four deployed addresses and the earlier EVM-only deployment. It stops before Mint because the four-contract gate is paused and its title commitment is a placeholder. [Judge walkthrough](#judge-walkthrough-5-minutes) is the five-minute route.

## Live status

| Surface | Status | The evidence |
|---|---|---|
| Marketing site and console | **Live** | [lemo-ebon.vercel.app](https://lemo-ebon.vercel.app) |
| Transaction console | **Live, gate paused** | [/console/flow](https://lemo-ebon.vercel.app/console/flow) |
| Blake2b adapter | **Live on Portaldot V3** | `0x15ae34fa8fd933d6d4e1cf9a772b305f0abc7e22` |
| Trie verifier | **Live on Portaldot V3** | `0xe5ca668667d3e2c8a0272ee4e446d6aa88a86bac` |
| Root feed | **Live, root attested** | `0xc1c95be2f38f865438f684d269f340f5c505d5c0`; root `0x19ff…8b80` at #294515 |
| ERC-20 gate | **Live, paused after the burn fix** | `0xfbefe3cbf0785b3d08814eb02a348c9ca296741f`; deployed bytecode predates the holder-only burn fix |
| `UnbondGuard` | **Not deployed** | Rule 2 logic tested; no live address |
| Earlier EVM-only deployment | **Live, settled receipts** | [`/console/legacy`](https://lemo-ebon.vercel.app/console/legacy); registry `0xc887…88bB`, token `0x61c3…8ff7` |
| Native title registry | **Pallet, not in the runtime** | `pallets/lemo-title`, 10 tests |
| Four-contract mint / transfer | **Wired, cannot settle** | placeholder commitment; no native title record |
| Proof service | **1,077 tests passing** | `server/` |
| Security audit | **Self-audit; critical hazards mitigated** | [docs/AUDIT.md](docs/AUDIT.md); C-01 amount binding and H-06/H-07 open |

The honest line: the site, the proof surface and four support contracts are live. The gate's title is a deployment placeholder, so this is not a live asset system yet.

## The 20-second pitch

Every wrapped asset answers "where is the backing?". LEMO asks a harder question: **does the token still have the right to exist?** The EVM gate checks a finalized native title proof before a mint, transfer or burn. The native side refuses to release backing while a representation is outstanding. The unit of authorisation is a revisioned title — backing, owner, identity, vesting and permissions in one commitment — not a balance. Every failed check reverts before a balance moves.

## How Portaldot is load-bearing, in plain words

Short version: **Portaldot is not a host; it is one of the two ledgers under test.**

1. **Native state.** The title record belongs in the native runtime, with backing, owner, identity, vesting, permissions and a monotonic revision.
2. **Revive state.** The ERC-20 representation lives in Revive, with balances, supply and a proof check before every movement.
3. **tPOT.** The native wallet pays the storage deposit for the contracts; an EVM address is only a mapped account.
4. **State proofs.** `state_getReadProof` at a finalized block is the input the Solidity verifier walks.
5. **Finality.** Both rooms settle under the same validator set. The current root feed is a trusted checkpoint, not a light client; that boundary is named in the code and the audit.

## Judge walkthrough (5 minutes)

Every step below runs on the public site. The read pages need no wallet and no install. Do not click Mint; it is paused on purpose.

1. **Open [lemo-ebon.vercel.app](https://lemo-ebon.vercel.app).** The hero says "The gate is deployed". The security band says `GATE PAUSED`, `TRUSTED ROOT FEED`, `ETH_GETPROOF REFUSED`. That is the current boundary, not marketing.
2. **Open [/console](https://lemo-ebon.vercel.app/console).** Check the finalized native height, the Revive head, the native/Revive identity row, and the state roots. Every number is read from the node, not fixture data.
3. **Open [/console/proofs](https://lemo-ebon.vercel.app/console/proofs).** The native witness and the EVM probe run side by side. The EVM side reports `eth_getProof` refusing; the native side returns a witness. The refusal is shown verbatim.
4. **Open [/console/verify](https://lemo-ebon.vercel.app/console/verify).** Prove one storage key against the finalized state root. The page walks the returned trie nodes in the browser; a tampered node or root is rejected.
5. **Open [/console/network](https://lemo-ebon.vercel.app/console/network).** Read the endpoint, genesis, chain id and latency checks. A failed check is reported as failed, never hidden.
6. **Open [/console/legacy](https://lemo-ebon.vercel.app/console/legacy).** This is the earlier EVM-only deployment. Verify supply `1,000`, cap `1,000`, eligibility `true`, issuer balance `985`, and five settled transaction receipts. This is the only place a **settled** mint and transfer can be shown today.
7. **Open [/console/flow](https://lemo-ebon.vercel.app/console/flow).** Read the three deployed addresses and the banner "Gate deployed and paused". Mint and transfer are wired but cannot settle: the gate has no real title proof.
8. **Do not expect a native create, identity, unbond or Rule 2 refusal.** Those need `pallets/lemo-title` in the runtime. The page says so.

What a judge can verify without trusting the site: the addresses and code on Portaldot V3, the four deployment transactions in [docs/EVIDENCE.md](docs/EVIDENCE.md), the five legacy receipts on `/console/legacy`, and the local test suites in [Tests](#tests).

## Table of contents

- [Demo video](#-demo-video)
- [Live status](#live-status)
- [The 20-second pitch](#the-20-second-pitch)
- [How Portaldot is load-bearing, in plain words](#how-portaldot-is-load-bearing-in-plain-words)
- [Judge walkthrough (5 minutes)](#judge-walkthrough-5-minutes)
- [See it in one command](#-see-it-in-one-command)
- [Verify every claim in one command](#verify-every-claim-in-one-command)
- [What LEMO is NOT](#what-lemo-is-not)
- [The problem I set out to solve](#the-problem-i-set-out-to-solve)
- [How projects with the same idea finish](#how-projects-with-the-same-idea-finish)
- [What I built](#what-i-built)
- [Architecture](#architecture)
- [The two rules, step by step](#the-two-rules-step-by-step)
- [Where the guarantee is enforced](#where-the-guarantee-is-enforced)
- [The live run](#the-live-run)
- [Why the native mint does not work](#why-the-native-mint-does-not-work)
- [The replacement we shipped](#the-replacement-we-shipped)
- [The burn fix and the pause](#the-burn-fix-and-the-pause)
- [Engineering decisions & the traps that taught me something](#engineering-decisions--the-traps-that-taught-me-something)
- [What's real vs pending — the honesty table](#whats-real-vs-pending--the-honesty-table)
- [Attack → test](#attack--test)
- [Limitations](#limitations)
- [Security](#security)
- [Tech stack](#tech-stack)
- [Project layout](#project-layout)
- [Full command reference](#full-command-reference)
- [How I'd deploy it](#how-id-deploy-it)
- [Tests](#tests)

## ▶ See it in one command

```bash
npm install && npm run dev
```

Open `http://localhost:3000` for the landing page, `/console` for the readings and `/console/legacy` for the settled predecessor. The app reaches Portaldot through the same-origin `/api/rpc/*` proxies; no wallet is needed for the read pages.

For the production build:

```bash
npm run build && npm run start
```

## Verify every claim in one command

```bash
npx tsc --noEmit
forge test
(cd server && npm test)
(cd pallets/lemo-title && cargo test)
```

```text
forge test                         90 passed, 0 failed
server npm test                 1,077 passed, 0 failed
cargo test (pallet)                10 passed, 0 failed
```

On macOS, if the pallet fails to link because CommandLineTools ships a newer SDK than clang accepts, set `SDKROOT` to the 15.4 SDK for that command. The failure is a local toolchain fault, not a test failure.

The live addresses, five settlement receipts and costs are in [docs/EVIDENCE.md](docs/EVIDENCE.md).

## What LEMO is NOT

- **Not a bridge.** No asset is locked on one chain and minted on another by a relayer. The verifier checks a proof against a root both sides already accept.
- **Not a wrapper.** The EVM token is not a claim on a custodian. It is a second face of the same title, gated by the native record.
- **Not a server authority.** The proof service carries bytes and verifies them; it cannot make a bad proof pass.
- **Not a live native asset system yet.** The native registry is a pallet outside the runtime, and the live gate has no real title to prove. The site says so.
- **Not audited.** [`docs/AUDIT.md`](docs/AUDIT.md) is a self-audit, not a third-party sign-off.
- **Not the earlier deployment.** `/console/legacy` is an EVM-only predecessor with real receipts. It is not the dual-runtime gate and must not be presented as one.

## The problem I set out to solve

Portaldot V3 has two ways to hold an asset and no shared contract storage between them.

- Native ownership rules do not automatically follow an ERC-20 or ERC-721 representation.
- Solidity applications see a token, not the identity, vesting or permissions behind it.
- Backing can leave while a representation still circulates.
- The usual fix is a synchronization service that becomes the authority.

Wrapping an asset moves it. It does not enforce the relationship between the original backing and its representation. LEMO makes the relationship the unit that both rooms have to accept.

## How projects with the same idea finish

The full census, with primary sources, is [`docs/competitive-research.md`](docs/competitive-research.md). It is a sample of the field, not an exhaustive claim.

| Project | What shipped | How it closes the gap | What LEMO still lacks |
|---|---|---|---|
| Polkadot ERC-20 precompile | `pallet-assets` exposed as an ERC-20 address | Aliasing: one ledger, two interfaces | A deployed native title registry |
| Hydration | Frontier EVM inside the native runtime | One runtime, one state; strongest objection to LEMO's premise | The native half in the runtime |
| Moonbeam XC-20 | XCM-transferable ERC-20s | Wrapped representation plus XCM custody | A two-way proof instead of custody |
| Snowbridge | Polkadot↔Ethereum bridge | BEEFY/Beacon light clients, permissionless relayers, third-party audits | A light-client root source and external audit |
| Evmos `x/erc20` | Governance-registered Coin/ERC-20 pairs | Runtime-enforced pair registry | A native title, not just a pair |
| Polymesh | Compliance on every transfer | Runtime identity claims and rules | An EVM face |
| Centrifuge | ERC-20 shares with transfer hooks | ERC-1404-style memberlists and per-transfer checks | A native record outside the EVM runtime |
| ERC-3643 / Tokeny | Compliant-token stack | On-chain identity and compliance registries | A second runtime that verifies the first |
| tBTC | Bitcoin redemption with SPV proofs | One-way proof verification plus bonded signers | The mirror rule (native release blocked by outstanding EVM supply) |

What they all did that this repo has not:

1. **Deployed the authoritative side.** Their registry or light client is live; our native registry is still a pallet.
2. **Closed the trust model.** Snowbridge has light clients and named audits; our root source is one attester and our audit is a self-audit.
3. **Shipped a stranger-runnable lifecycle.** They have a live mint/transfer/redeem path with published transactions; our four-contract path cannot settle. The earlier two-contract deployment does, but only in EVM.
4. **Published an external review.** We have not.

LEMO's differentiator is still real: the unit of authorisation is a revisioned **title** — backing, owner, identity, vesting and permissions in one commitment — not a balance, and the invariant is meant to run both ways. The missing pieces are deployment and review, not the idea.

## What I built

- **Solidity verifier**: walks blake2b-256 Substrate trie nodes from a state root, decodes a 320-byte title record, and returns a typed status.
- **Title gates**: ERC-20 and ERC-721 variants that bind chain, title, token, operation, revision, root and commitment before any balance moves.
- **Root feeds**: a single-attester `RootFeed` and an M-of-N `ThresholdRootFeed`.
- **Unbond guard**: Rule 2 in Solidity, with a release recheck and one open request per title.
- **Native pallet**: `pallets/lemo-title`, with create, edit, representation, fail-closed liveness and unbond calls; 10 tests.
- **Proof service**: a Fastify service with typed RPC clients, trie verification, fixtures and 1,077 tests.
- **Console**: landing, overview, proof walk, key verifier, network checks, a transaction surface and a read-only page for the earlier deployment.
- **Deployment tooling**: `revive.instantiateWithCode` from the native SS58 wallet, plus the Foundry path and cost measurement.

## Architecture

```text
                      Portaldot native runtime
        owner / identity / vesting / permissions / backing
                          │
                          ▼
                  title record + revision
                          │
                  finalized state root
                          │
                  storage inclusion proof
                          │
                    RootFeed (checkpoint)
                          │
                          ▼
        Revive: SubstrateTrieVerifier ──► TitleGateERC20 / ERC721
                          ▲                       │
                          │                       ▼
                    action nullifier        supply + ownership
                          │
                  native release check ──► UnbondGuard (not deployed)
                          │
                  earlier EVM-only path ──► /console/legacy (settled)
```

| Component | File | Role |
|---|---|---|
| Trie verifier | `contracts/SubstrateTrieVerifier.sol` | walk a Substrate proof from a state root |
| Gate base | `contracts/TitleGateBase.sol` | bind chain, title, token, operation, root, revision |
| ERC-20 gate | `contracts/TitleGateERC20.sol` | cap, owner-bound mint, holder-only burn |
| ERC-721 gate | `contracts/TitleGateERC721.sol` | owner-bound mint and ERC-165 |
| Root feed | `contracts/RootFeed.sol` | one attested checkpoint |
| Threshold feed | `contracts/ThresholdRootFeed.sol` | M-of-N attestation |
| Unbond guard | `contracts/UnbondGuard.sol` | Rule 2, release recheck, one open request |
| Native pallet | `pallets/lemo-title/src/lib.rs` | title storage and native calls |
| Proof service | `server/` | RPC clients, verifier, fixtures |
| Earlier deployment | `contracts/src/LemoTitle.sol`, `contracts/src/LemoERC20Lite.sol` | EVM-only predecessor with receipts |

## The two rules, step by step

### Rule 1: the EVM gate checks the native title

1. Read `chain_getFinalizedHead` and the header at that hash.
2. Ask `state_getReadProof` for the title's storage key at that block.
3. Index every returned node by `blake2b_256(node)`.
4. Walk from the state root, consuming partial keys and branch nibbles.
5. Decode the 320-byte title record.
6. Recompute the commitment and compare it with the gate's title commitment.
7. Check the chain, title id, token address, operation, revision and current feed root.
8. Consume the action nullifier and only then move the balance.

### Rule 2: the native side checks the representation

`UnbondGuard.requestUnbond` refuses while `representationOutstanding()` is true, spends the proof's nullifier and records one open request per title. `completeUnbond` re-checks `representationOutstanding()` at release time, so a burn → request → re-mint sequence cannot release backing twice.

The native pallet implements the same rule as `request_unbond` with a `RepresentationLive` check that must be an explicit `Some(false)`; an unset flag is fail-closed. The pallet is source and tests, not a runtime deployment.

## Where the guarantee is enforced

| Guarantee | Enforced by |
|---|---|
| No EVM state change without a current native proof | `TitleGateBase._gate`, `SubstrateTrieVerifier.verifyTitle` |
| A proof cannot be replayed for the same action | action-scoped nullifier in `TitleGateBase` |
| A mint cannot exceed the supply cap | `TitleGateERC20.maxSupply` |
| A mint cannot be front-run to another recipient | `mint` binding to `record.owner` |
| A burn cannot destroy another holder's balance | `burn` holder check |
| Native release is blocked while a representation exists | `UnbondGuard.requestUnbond` and `completeUnbond` |
| Unknown liveness cannot authorise an unbond | `RepresentationLive` `OptionQuery` + `Some(false)` |
| The node cannot invent the value | verifier returns `ABSENT`, `INCOMPLETE`, `INVALID`, `ROOT_MISMATCH` or `VALUE_MISMATCH` |

## The live run

### Why the native mint does not work

A settled four-contract mint needs four things at once, and only two exist on the public chain:

1. **A native title record** at a real storage key in the Portaldot runtime. `pallets/lemo-title` is not in the runtime, so the key does not exist.
2. **A finalized state root that contains that key.** `RootFeed` holds a real root, but it contains no LEMO title.
3. **A valid Substrate storage proof from that root.** The verifier can check one; there is nothing to prove.
4. **A gate commitment and revision matching that record.** The deployed gate has a placeholder commitment and `acceptedRevision = 0`.

The gate is also paused after the burn fix, but unpausing would not help: the proof check would still reject. There is no owner bypass in `mint`; that is deliberate. The same gap blocks native create, identity, unbond and the Rule 2 refusal.

### The replacement we shipped

The repository contains an **earlier EVM-only deployment**, and it has settled transactions on Portaldot V3:

| Contract | Address | Live reading |
|---|---|---|
| `LemoTitle` | `0xc88763FA361669fC5d95c2BDD924b0E2872488bB` | title `0xeeee…eeee`; backing `1,000`; revision `292498`; eligible `true` |
| `LemoERC20Lite` | `0x61c35d5e811b99f2641b43e9ef97e50d52de8ff7` | supply `1,000`; cap `1,000`; issuer holds `985` |

It has five settled receipts, read live on [`/console/legacy`](https://lemo-ebon.vercel.app/console/legacy):

| Action | Transaction | Block |
|---|---|---|
| Mint 1,000 | `0xe7391b28393c1273b0d9e5316725408c57e189b2ee34447fe77c8cb1ace8b525` | 292633 |
| Transfer 10 | `0x82cf8b4ea676eb30b29e31ab9019c571fd650c2d27e2c10e88cba7bf9478c11f` | 292634 |
| Freeze title | `0xc038a6d31cd1076a0dfe60b0267b28b4bc85458af15ee8582a3cf2bb4a599a2f` | 292639 |
| Unfreeze title | `0xd8958bbf3de0dfc42cab20b8d1a013da4cd1a44c550b107e58f7e791c9e4f068` | 292640 |
| Transfer 5 | `0xfab5374ab496e3211379d0cce42475b681748f105652c03fe7d8268aad7f95b8` | 292641 |

This replacement proves that an ERC-20 can be minted to a cap and moved while a registry says the title is eligible. It also proves a transfer refusal while frozen and a working transfer after unfreeze.

It does **not** prove a native record, a Substrate storage proof, Rule 2, an unbond, or the four-contract gate. The registry is EVM storage. The issuer key is not held by the console, so the page is read-only. Present it as "the earlier on-chain deployment", never as the dual-runtime gate.

### The burn fix and the pause

The independent review found a real defect in `TitleGateERC20.burn`: the gate owner could burn **any holder's** balance, and burning the supply would make `representationOutstanding()` false and release native backing. The fix in source:

- `burn` now allows only the holder (`msg.sender == from`).
- `transfer` now binds `msg.sender` in the action hash, matching `transferFrom`.
- `test_GateOwnerCannotBurnAHolder` asserts the owner path reverts.
- Foundry grew from 89 to **90 tests**.

The deployed gate cannot be patched. It was **paused** at `0xfc7fb72e7c56c9e723dbc03032a06e82ad018174f22f12559a364502245a05bf`; `paused()` reads `true`. A clean live fix needs a new gate deployment, roughly 500 tPOT. The native wallet has 153.39. Until that deployment, the live gate must stay paused and the README must say so.

## Engineering decisions & the traps that taught me something

1. **Storage is the cost.** Portaldot charges `0.06 tPOT` per code byte plus a 30% code-hash lockup. A 779-byte hasher costs 71.78 tPOT; the four-contract suite cost about 1,378 tPOT. Measure before broadcasting.
2. **tPOT is native.** An EVM address holds its tPOT through the `H160 ++ 0xEE*12` mapping. Funding the `0x` address directly does nothing.
3. **EVM constructor arguments belong in the code blob.** `revive.instantiateWithCode` rejects separate `data` with `EvmConstructorNonEmptyData`.
4. **The weight limit must fit the block.** Passing `maxEthExtrinsicWeight` returns "Transaction would exhaust the block limits"; `1.5e12` refTime works.
5. **The public RPC drops bursts.** Browser calls were blocked by CORS on 503. The app uses same-origin `/api/rpc/*` proxies with a retry and a short cache.
6. **The Vercel build typechecks the repo.** The merged `backend/` package uses `.ts` imports; the root `tsconfig` excludes it so `next build` stays green.
7. **The chart needs a height before it can measure.** `ResponsiveContainer` now has `minHeight={240}`.

## What's real vs pending — the honesty table

| Claim | Status | Evidence |
|---|---|---|
| Four support contracts deployed | **Yes** | addresses above, `docs/EVIDENCE.md` |
| Root feed has an attested finalized root | **Yes** | `currentRoot` at block 294515 |
| Solidity verifier passes a real Substrate proof | **Yes** | `test/SubstrateTrieVerifier.t.sol` |
| Browser verifier passes a real Substrate proof | **Yes** | `server/test/fixtures/portaldot-v3.json` |
| Earlier deployment minted and transferred | **Yes** | five settled receipts on `/console/legacy` |
| Gate binds a real native title | **No** | placeholder commitment |
| Four-contract mint and transfer settle | **No** | no native title proof; gate paused |
| Native registry is live | **No** | pallet not in the runtime |
| Rule 2 is enforced on native | **No** | pallet not in the runtime; `UnbondGuard` not deployed |
| Independent root source | **No** | single-attester `RootFeed` |
| External audit | **No** | self-audit only |

## Attack → test

| Attack | Test that refuses it |
|---|---|
| Mint without backing | `test_01_MintWithoutBacking` |
| Mint with no proof | `test_02_MintWithNoProof` |
| Burn another holder's balance | `test_BurnByAnOutsiderIsRefusedBeforeTheProof` |
| Gate owner burns a holder | `test_GateOwnerCannotBurnAHolder` |
| Replay the same action | `test_06_ProofDoubleSpend` |
| Replay after a new root | action-scoped nullifier + `test_RevertOnReplayedProof` |
| Use a mint proof to burn | `test_05_BurnWithAMintProof` |
| Burn proof to mint | `test_08_BurnProofCannotMint` |
| Stale root | `test_15_StaleRoot` |
| Wrong token contract | `test_16_WrongTokenBinding` |
| Wrong revision | `test_18_RevisionClaimDoesNotMatchTheRecord` |
| Cleared identity | `test_19_ClearedIdentity` |
| Unbond while supply is outstanding | `test_12_UnbondWhileRepresentationOutstanding` |
| Complete an unbond after a re-mint | `test_21_CompletedUnbondRechecksRepresentation` |
| Two open unbonds for one title | `test_22_OnlyOneOpenUnbondPerTitle` |
| Zero-recipient mint | `test_MintCannotExceedTheCommittedSupplyCap` + ERC-721 zero check |
| Unknown native liveness | `unbond_is_refused_while_representation_state_is_unknown` |

## Limitations

- The native registry is a pallet, not a runtime. The public V3 node does not expose the contracts API, so the native half cannot run here.
- `UnbondGuard` is not deployed. Rule 2 is tested but has no live address.
- The live gate is **paused** and its bytecode predates the holder-only burn fix. The source is fixed and tested; the deployed gate must be redeployed before any live use.
- The live gate's commitment is a placeholder. It is a real contract with a real verifier, but there is no real title to prove.
- The root feed is one attester. `ThresholdRootFeed` exists and is tested but is not deployed.
- The pallet's SCALE record is 260 bytes, while the EVM decoder expects 320 with a 160-bit owner. H-06 is open and fail-closed.
- A distinct action at the same revision gets a distinct nullifier; the audit's H-01 notes that a true per-revision spend counter is still the stronger design.
- No external audit. The self-audit is in [`docs/AUDIT.md`](docs/AUDIT.md).

## Security

- [`docs/AUDIT.md`](docs/AUDIT.md): 28 findings, critical hazards mitigated, H-06/H-07 open. C-01 is bounded by a global cap; the amount-to-record binding is still missing.
- Mitigations: supply cap, recipient binding, holder-only burn, action-scoped nullifier, unbond release recheck, one open request per title, zero-recipient refusal, ERC-165.
- The proof service never accepts a caller-supplied state root.
- The public RPC proxy uses a method allowlist and does not expose wallet-signing methods.
- The earlier deployment's issuer key is not held by this console; `/console/legacy` is read-only.

## Tech stack

- Next.js 16 App Router, React 19, Tailwind v4, TypeScript
- Foundry, Solidity 0.8.26
- Substrate FRAME pallet, Rust
- Fastify proof service, TypeScript
- Portaldot V3 Revive EVM, chain id 420420777
- Vercel production deployment

## Project layout

```text
app/                 landing, console routes, /api/rpc proxy, /console/legacy
components/          marketing, console, wallet, flow panels
lib/                 chain reads, proofs, wallet, flow codecs, legacy reads
contracts/           four-contract gate and Foundry tests
contracts/src/       earlier EVM-only registry and token
pallets/lemo-title/  native title registry pallet
server/              Fastify proof service
backend/             parallel proof service for the two-contract deployment
docs/                evidence, audit, deployment, demo, competitive research
test/                Foundry tests and harnesses
script/              Foundry deployment script
scripts/             native deploy and root attestation
```

## Full command reference

```bash
# site
npm install
npm run dev
npm run build
npm run start

# contracts
forge build
forge test

# native pallet
cd pallets/lemo-title && cargo test

# proof service
cd server && npm install && npm test

# native deployment (native tPOT wallet)
PORTALDOT_MNEMONIC=... STORAGE_LIMIT_TPOT=650 \
  node scripts/native-deploy.mjs TitleGateERC20 <constructorArgsHex>

# root attestation
ATTESTER_PRIVATE_KEY=... FEED_ADDRESS=0xc1c9…d5c0 \
  EVM_RPC=https://test-evm-rpc-v3.portaldot.dev ./scripts/attest-root.sh
```

## How I'd deploy it

1. Include `pallets/lemo-title` in a Portaldot runtime upgrade and expose a runtime API for the fixed-width title record.
2. Create a title with real backing and identity; publish its revision.
3. Attest the finalized root and set the gate's title commitment to that record.
4. Move the gate from the single-attester `RootFeed` to a deployed `ThresholdRootFeed` with independent attesters.
5. Deploy a new gate with the holder-only burn fix, then get an external audit before calling the asset system production-ready.

## Tests

```text
forge test                         90 passed, 0 failed
cargo test (pallet)                10 passed, 0 failed
server npm test                 1,077 passed, 0 failed
```

The proof tests include a live-captured Portaldot fixture, tampered root, tampered child, wrong key, truncation, false absence and a 1,019-case stress suite. The gate tests cover stale root, old revision, unbound backing, cleared identity, wrong contract, wrong chain, wrong operation, replay, pause, supply cap, recipient binding, holder-only burn and an interrupted unbond.

---

Four support contracts are deployed on Portaldot V3. The native registry, a real title proof and the external audit are still missing. The earlier EVM-only deployment is the only place a settled mint and transfer can be shown today. The site says all of that on every page.
