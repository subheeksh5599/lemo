#!/usr/bin/env bash
# Rebuild the local runtime LEMO's /console/local run comes from:
# the Parity solochain template at a pinned commit, plus the lemo-title pallet
# from this repo, plus the patches in this folder. Output: local-runtime/build/.
#   ./local-runtime/setup.sh            # clone, patch, build (release)
#   SKIP_BUILD=1 ./local-runtime/setup.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LEMO="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/build"
TEMPLATE=https://github.com/paritytech/polkadot-sdk-solochain-template.git
COMMIT=1adedaffe70df1dab07e34e6a57c19e732ececb9

if [[ ! -d "$BUILD/.git" ]]; then
  git clone -q "$TEMPLATE" "$BUILD"
fi
cd "$BUILD"
git checkout -q "$COMMIT"
git reset -q --hard "$COMMIT"
git clean -qfd pallets/lemo-title
git apply "$HERE/template.patch"
mkdir -p pallets/lemo-title/src
cp "$LEMO/pallets/lemo-title/Cargo.toml" pallets/lemo-title/Cargo.toml
cp "$LEMO/pallets/lemo-title/src/lib.rs" pallets/lemo-title/src/lib.rs
git apply "$HERE/pallet-in-workspace.patch"
echo "patched template at $COMMIT in $BUILD"

if [[ -z "${SKIP_BUILD:-}" ]]; then
  rustup target add wasm32-unknown-unknown >/dev/null
  cargo build --release -p solochain-template-node
  echo "node: $BUILD/target/release/solochain-template-node"
fi
