# Local runtime proof check

Reproduces the native LEMO title capture end to end on one machine: build the
solochain template with the `LemoTitle` pallet, start it with `--dev --tmp`,
capture a title and both storage proofs, verify them with the same TypeScript
verifier the app uses, then stop the node.

This is a local-only check. It uses the public `//Alice` development key and a
temporary chain that is discarded on exit. It never touches a public network.

## What runs

| Piece | Path |
| --- | --- |
| Recipe | `local-runtime/setup.sh`: clones the Parity solochain template at `1adedaf`, applies `local-runtime/template.patch`, copies `pallets/lemo-title` in and applies `local-runtime/pallet-in-workspace.patch` |
| Node binary | `local-runtime/build/target/release/solochain-template-node` (built by `setup.sh`, not checked in) |
| Runtime | `local-runtime/build/runtime` (`LemoTitle` = `pallet_lemo_title`, pallet index 8) |
| Pallet | `pallets/lemo-title` (calls 0-5); the workspace patch only adapts its `Cargo.toml` and `RuntimeEvent` to the template's SDK version |
| Capture | `scripts/local-capture.mjs` |
| Verifier | `lib/proofs.ts` (`verifyProof`) |
| Check runner | `local-runtime/scripts/local-proof-check.sh` |
| Result JSON | `local-runtime/build/artifacts/local-proof-result.json`; a recorded result is at `local-runtime/local-proof-result.json` |
| Node log | `local-runtime/build/artifacts/node.log` |
| Fixture | `lemo/fixtures/lemo-local-capture.json` |

Requirements: macOS with the Xcode command line tools, Rust stable with the
`wasm32-unknown-unknown` target, Node >= 22.6 (the check imports `proofs.ts`
directly using Node's type stripping; verified on v26.12.1), and `curl`.

## Build

From a clone of this repo:

```bash
SKIP_BUILD=1 ./local-runtime/setup.sh   # clone the template and patch it
cd local-runtime/build

rustup target add wasm32-unknown-unknown

# 1. Pin the SDK. Newer command line tool SDKs break the libc/socket headers
#    that Rust's build scripts compile against.
export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk

# 2. Make bindgen find libclang. On macOS bindgen only accepts
#    libclang.dylib, and it must be in a directory named by LIBCLANG_PATH.
#    (Run these inside local-runtime/build.)
mkdir -p target/release/deps
ln -sf /Library/Developer/CommandLineTools/usr/lib/libclang.dylib target/release/libclang.dylib
ln -sf /Library/Developer/CommandLineTools/usr/lib/libclang.dylib target/release/deps/libclang.dylib
export LIBCLANG_PATH="$PWD/target/release"

# 3. Let the wasm runtime link against host functions the template provides
#    but does not define in the wasm object.
export WASM_BUILD_RUSTFLAGS="-C link-arg=--allow-undefined"

cargo build --release -p solochain-template-node
```

Verified 2026-11-05: built from a fresh `setup.sh` checkout on macOS 26 (rustc 1.99.1), then `local-runtime/scripts/local-proof-check.sh` passed all nine checks; the result is recorded in [`local-runtime/local-proof-result.json`](../local-runtime/local-proof-result.json).

The symlinks are deliberately inside `target/`, so they are build output and
never checked in. If `LIBCLANG_PATH` is wrong the failure happens in
`librocksdb-sys`/bindgen; if `SDKROOT` is wrong it happens while compiling C
dependencies, not in the runtime crate.

Pallet tests (22) run without the wasm build, from `pallets/lemo-title`:

```bash
cd pallets/lemo-title && SKIP_WASM_BUILD=1 cargo test
```

## Run

One command does start, health wait, capture, verify, result write, and stop:

```bash
./local-runtime/scripts/local-proof-check.sh
```

It refuses to start if port 9944 is already taken, and it stops the node on
success, error, or Ctrl-C. Overrides: `RUNTIME_DIR`, `PORT`, `BIN`, `LEMO_DIR`,
`ARTIFACT_DIR`, `CAPTURE_OUT`, `RESULT_OUT`, `LOG_OUT`, `NODE_BIN`.

The underlying commands, if you want to run them by hand:

```bash
local-runtime/build/target/release/solochain-template-node --dev --tmp --rpc-port 9944 --rpc-methods=unsafe
curl -s http://127.0.0.1:9944/health     # wait for "isSyncing":false

node scripts/local-capture.mjs ws://127.0.0.1:9944 fixtures/lemo-local-capture.json
node local-runtime/scripts/verify-local-proof.mjs fixtures/lemo-local-capture.json /tmp/local-proof-result.json
```

`--rpc-methods=unsafe` is enabled only because `state_getReadProof` is an
unsafe RPC. The chain is `--dev --tmp` and listens on loopback.

## What is proven

The verifier hashes every proof node with blake2b-256, walks the trie path for
the storage key, and checks the computed root against the state root in the
finalized header. The current run proves:

- Finalized block varies per run on chain `Development`, runtime `specVersion` 100.
- Raw `LemoTitle::Titles` value: 280 bytes, 4 proof nodes (784 bytes),
  `status=valid`, `rootMatches=true`, proven bytes equal the captured bytes.
- Canonical `LemoTitle::CanonicalTitles` value: 320 bytes, 4 proof nodes
  (824 bytes), `status=valid`, `rootMatches=true`, proven bytes equal the
  captured bytes.
- Both proofs resolve to the same finalized header state root, so the two
  records are bound to one block, not two snapshots.
- The result JSON records all nine checks and exits non-zero if any fail. A
  tampered proof node produces `status=incomplete` or `root-mismatch` and a
  non-zero exit, so the check is not vacuous.

Roots and block hashes change on every run because `--tmp` starts a fresh chain
and the capture sets a representation-live flag with its own timestamped block.
Lengths, node counts, step counts, and `valid` status are stable.

## What is still missing

- **No Revive / EVM.** This template is a plain solochain. There is no
  `pallet-revive`, no EVM execution, no `eth-rpc`, no Solidity deployment.
  The fixture's `evmContract` is bound to the local Foundry gate only; the
  runtime cannot execute that gate.
- **No contract-level proof.** The check proves native storage values, not
  contract storage slots or `eth_getProof` output.
- **No persistence.** `--tmp` deletes state on exit; there is no database
  snapshot to reproduce a block later.
- **No network finality.** Single dev node with instant-seal/Aura dev behavior;
  GRANDPA finality depth, reorgs, and multi-node agreement are untested.
- **No production keys or public chain.** `//Alice` is public test material;
  nothing here signs against a live network.
- **Wasm execution is not exercised at runtime** beyond the compiled runtime;
  the capture goes through the native runtime API and storage proof path only.

## End-to-end lifecycle run (native + anvil)

`scripts/local-e2e.mjs` drives the whole lifecycle with real transactions and
writes `fixtures/local-e2e.json`, which `/console/local` renders and re-verifies
in the browser and `local-evm/test/LocalE2E.t.sol` replays.

```bash
# native: keep a GRANDPA justification for every commit target so
# chain_getBlock returns it (engine id FRNK); the default period is 512
LEMO_GRANDPA_JUSTIFICATION_PERIOD=1 local-runtime/build/target/release/solochain-template-node --dev --tmp --rpc-port 9944

# EVM: a fresh anvil (the gate address is predicted from the deployer nonce)
anvil --port 8545

cd local-evm && forge build
cd .. && node scripts/local-e2e.mjs fixtures/local-e2e.json
cd local-evm && forge test --match-contract LocalE2E
```

Order: create_title, set_representation (predicted gate), sudo
set_representation_live(true), capture proof A at a justified block; deploy
hasher, verifier, feed, gate, guard on anvil, attest root A, mint, transfer,
replayed transfer (reverts); request_unbond (refused, RepresentationLive) and
UnbondGuard.requestUnbond (reverts); capture proof B, attest, transfer back,
burn, guard request and complete; sudo live(false), request_unbond,
finalize_unbond early (refused, UnbondingNotDue), finalize_unbond after the
period; capture proof C (key absent). The burn uses the same revision as the
mint: mint and burn nullifiers are separate, so no revision bump is needed.
