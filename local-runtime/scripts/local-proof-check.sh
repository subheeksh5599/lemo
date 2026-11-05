#!/usr/bin/env bash
# Reproducible local proof check for the LEMO native pallet.
#
# Starts the already-built release node on 127.0.0.1:9944, waits for health,
# runs the joint capture from the lemo repo, verifies the raw and canonical
# storage proofs with lemo/lib/proofs.ts, writes a result JSON, and stops the
# node. The node always runs with --dev --tmp, so the chain starts from genesis
# and nothing outside the artifact directory is persisted.
#
# Usage:
#   scripts/local-proof-check.sh
#
# Environment overrides:
#   PORT=9944            RPC port
#   BIN=...              node binary (default target/release/solochain-template-node)
#   LEMO_DIR=...         lemo repo with scripts/local-capture.mjs and lib/proofs.ts
#   ARTIFACT_DIR=...     output directory (default <runtime>/artifacts)
#   CAPTURE_OUT=...      capture JSON path (default <lemo>/fixtures/lemo-local-capture.json)
#   NODE_BIN=...         node executable used for capture + verification

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${RUNTIME_DIR:-$HERE/build}"
LEMO_DIR="${LEMO_DIR:-$HERE/..}"
PORT="${PORT:-9944}"
BIN="${BIN:-$ROOT/target/release/solochain-template-node}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$ROOT/artifacts}"
CAPTURE_OUT="${CAPTURE_OUT:-$ARTIFACT_DIR/local-capture.json}"
RESULT_OUT="${RESULT_OUT:-$ARTIFACT_DIR/local-proof-result.json}"
LOG_OUT="${LOG_OUT:-$ARTIFACT_DIR/node.log}"
ENDPOINT="ws://127.0.0.1:$PORT"
HEALTH_URL="http://127.0.0.1:$PORT/health"

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
if [[ -z "$NODE_BIN" ]]; then
  echo "error: node not found on PATH (need Node >= 22.6 for TypeScript imports)" >&2
  exit 2
fi

for required in "$BIN" "$LEMO_DIR/scripts/local-capture.mjs" "$LEMO_DIR/lib/proofs.ts"; do
  if [[ ! -e "$required" ]]; then
    echo "error: missing $required" >&2
    exit 2
  fi
done

mkdir -p "$ARTIFACT_DIR"
rm -f "$RESULT_OUT"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "error: port $PORT is already in use; stop that process first" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2
  exit 2
fi

NODE_PID=""
cleanup() {
  local code=$?
  if [[ -n "$NODE_PID" ]] && kill -0 "$NODE_PID" 2>/dev/null; then
    echo "stopping node (pid $NODE_PID)"
    kill -TERM "$NODE_PID" 2>/dev/null || true
    for _ in $(seq 1 40); do
      kill -0 "$NODE_PID" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$NODE_PID" 2>/dev/null; then
      kill -KILL "$NODE_PID" 2>/dev/null || true
    fi
    wait "$NODE_PID" 2>/dev/null || true
  fi
  NODE_PID=""
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "warning: something is still listening on port $PORT" >&2
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM

echo "starting $BIN --dev --tmp --rpc-port $PORT"
"$BIN" --dev --tmp --rpc-port "$PORT" --rpc-methods=unsafe >"$LOG_OUT" 2>&1 &
NODE_PID=$!

healthy=0
for _ in $(seq 1 240); do
  if ! kill -0 "$NODE_PID" 2>/dev/null; then
    echo "error: node exited during startup; last log lines:" >&2
    tail -n 40 "$LOG_OUT" >&2 || true
    exit 1
  fi
  if curl -fsS --max-time 1 "$HEALTH_URL" 2>/dev/null \
      | grep -Eq '"isSyncing"[[:space:]]*:[[:space:]]*false'; then
    healthy=1
    break
  fi
  sleep 0.25
done

if [[ "$healthy" -ne 1 ]]; then
  echo "error: node did not report healthy at $HEALTH_URL; last log lines:" >&2
  tail -n 40 "$LOG_OUT" >&2 || true
  exit 1
fi

echo "node healthy at $HEALTH_URL"
echo "capturing $ENDPOINT -> $CAPTURE_OUT"
cd "$LEMO_DIR"
"$NODE_BIN" scripts/local-capture.mjs "$ENDPOINT" "$CAPTURE_OUT"

echo "verifying proofs"
cd "$ROOT"
"$NODE_BIN" "$HERE/scripts/verify-local-proof.mjs" "$CAPTURE_OUT" "$RESULT_OUT"

echo
echo "result: $RESULT_OUT"
"$NODE_BIN" --input-type=module -e '
  import { readFileSync } from "node:fs";
  const result = JSON.parse(readFileSync(process.argv[1], "utf8"));
  console.log(`ok=${result.ok} block=${result.block.number} root=${result.block.stateRoot}`);
  console.log(`raw       value=${result.raw.valueBytes}B nodes=${result.raw.proofNodeCount} status=${result.raw.status}`);
  console.log(`canonical value=${result.canonical.valueBytes}B nodes=${result.canonical.proofNodeCount} status=${result.canonical.status}`);
' "$RESULT_OUT"
