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
| Node binary | `lemo-runtime/target/release/solochain-template-node` |
| Runtime | `lemo-runtime/runtime` (`LemoTitle` = `pallet_lemo_title`, pallet index 8) |
| Pallet | `lemo-runtime/pallets/lemo-title` (calls 0-5) |
| Capture | `lemo/scripts/local-capture.mjs` |
| Verifier | `lemo/lib/proofs.ts` (`verifyProof`) |
| Check runner | `lemo-runtime/scripts/local-proof-check.sh` |
| Result JSON | `lemo-runtime/artifacts/local-proof-result.json` |
| Node log | `lemo-runtime/artifacts/node.log` |
| Fixture | `lemo/fixtures/lemo-local-capture.json` |

Requirements: macOS with the Xcode command line tools, Rust stable with the
`wasm32-unknown-unknown` target, Node >= 22.6 (the check imports `proofs.ts`
directly using Node's type stripping; verified on v26.12.1), and `curl`.

## Build

`target/release/solochain-template-node` is already built. To rebuild from a
clean checkout:

```bash
cd /Users/subheeksh/code/lemo-runtime

rustup target add wasm32-unknown-unknown

# 1. Pin the SDK. Newer command line tool SDKs break the libc/socket headers
#    that Rust's build scripts compile against.
export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk

# 2. Make bindgen find libclang. On macOS bindgen only accepts
#    libclang.dylib, and it must be in a directory named by LIBCLANG_PATH.
mkdir -p target/release/deps
ln -sf /Library/Developer/CommandLineTools/usr/lib/libclang.dylib target/release/libclang.dylib
ln -sf /Library/Developer/CommandLineTools/usr/lib/libclang.dylib target/release/deps/libclang.dylib
export LIBCLANG_PATH="$PWD/target/release"

# 3. Let the wasm runtime link against host functions the template provides
#    but does not define in the wasm object.
export WASM_BUILD_RUSTFLAGS=--allow-undefined

cargo build --release -p solochain-template-node
```

The symlinks are deliberately inside `target/`, so they are build output and
never checked in. If `LIBCLANG_PATH` is wrong the failure happens in
`librocksdb-sys`/bindgen; if `SDKROOT` is wrong it happens while compiling C
dependencies, not in the runtime crate.

Pallet tests (10) run without the wasm build:

```bash
SKIP_WASM_BUILD=1 cargo test -p pallet-lemo-title
```

## Run

One command does start, health wait, capture, verify, result write, and stop:

```bash
cd /Users/subheeksh/code/lemo-runtime
./scripts/local-proof-check.sh
```

It refuses to start if port 9944 is already taken, and it stops the node on
success, error, or Ctrl-C. Overrides: `PORT`, `BIN`, `LEMO_DIR`,
`ARTIFACT_DIR`, `CAPTURE_OUT`, `RESULT_OUT`, `LOG_OUT`, `NODE_BIN`.

The underlying commands, if you want to run them by hand:

```bash
cd /Users/subheeksh/code/lemo-runtime
target/release/solochain-template-node --dev --tmp --rpc-port 9944 --rpc-methods=unsafe
curl -s http://127.0.0.1:9944/health     # wait for "isSyncing":false

cd /Users/subheeksh/code/lemo
node scripts/local-capture.mjs ws://127.0.0.1:9944 fixtures/lemo-local-capture.json

cd /Users/subheeksh/code/lemo-runtime
node scripts/verify-local-proof.mjs ../lemo/fixtures/lemo-local-capture.json artifacts/local-proof-result.json
```

`--rpc-methods=unsafe` is enabled only because `state_getReadProof` is an
unsafe RPC. The chain is `--dev --tmp` and listens on loopback.

## What is proven

The verifier hashes every proof node with blake2b-256, walks the trie path for
the storage key, and checks the computed root against the state root in the
finalized header. The current run proves:

- Finalized block varies per run on chain `Development`, runtime `specVersion` 100.
- Raw `LemoTitle::Titles` value: 260 bytes, leaf node 260 bytes, 4 proof
  nodes (98 + 234 + 139 + 260 bytes), 3 path steps, `status=valid`,
  `rootMatches=true`, proven bytes equal the captured bytes.
- Canonical `LemoTitle::CanonicalTitles` value: 320 bytes, leaf node
  320 bytes, 4 proof nodes (98 + 234 + 139 + 320 bytes), 3 path steps,
  `status=valid`, `rootMatches=true`, proven bytes equal the captured bytes.
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
