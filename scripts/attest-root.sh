#!/usr/bin/env bash
# Publish one finalized native root to a RootFeed or ThresholdRootFeed.
#
# Required:
#   ATTESTER_PRIVATE_KEY   the EVM key of one attester (never printed)
#   FEED_ADDRESS           RootFeed or ThresholdRootFeed address
#   EVM_RPC                Revive JSON-RPC endpoint
# Optional:
#   NATIVE_RPCS            comma separated native endpoints; all must agree
#   EXPECTED_CHAIN_ID      refuse if the EVM endpoint reports another chain
#
# The script reads chain_getFinalizedHead + chain_getHeader from every native
# endpoint, refuses unless all endpoints return the same root and block, then
# sends attest(root, block) from this attester. Run it on each attester; a
# threshold feed accepts the root once the quorum has done the same.
set -euo pipefail

: "${ATTESTER_PRIVATE_KEY:?set ATTESTER_PRIVATE_KEY}"
: "${FEED_ADDRESS:?set FEED_ADDRESS}"
: "${EVM_RPC:?set EVM_RPC}"

NATIVE_RPCS="${NATIVE_RPCS:-https://test-node-v3.portaldot.dev}"
IFS=',' read -r -a endpoints <<< "$NATIVE_RPCS"

if [[ ${#endpoints[@]} -eq 0 ]]; then
  echo "no native endpoints" >&2
  exit 1
fi

if [[ -n "${EXPECTED_CHAIN_ID:-}" ]]; then
  observed="$(cast chain-id --rpc-url "$EVM_RPC")"
  if [[ "$observed" != "$EXPECTED_CHAIN_ID" ]]; then
    echo "wrong EVM chain: expected $EXPECTED_CHAIN_ID, got $observed" >&2
    exit 1
  fi
fi

root=""
block=""
for endpoint in "${endpoints[@]}"; do
  endpoint="${endpoint// /}"
  head="$(
    curl -sS --max-time 20 -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"chain_getFinalizedHead","params":[]}' \
      "$endpoint" | jq -r '.result // empty'
  )"
  if [[ -z "$head" ]]; then
    echo "no finalized head from $endpoint" >&2
    exit 1
  fi

  header="$(
    curl -sS --max-time 20 -H 'content-type: application/json' \
      -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"chain_getHeader\",\"params\":[\"$head\"]}" \
      "$endpoint"
  )"
  nextRoot="$(jq -r '.result.stateRoot // empty' <<< "$header")"
  nextBlockHex="$(jq -r '.result.number // empty' <<< "$header")"

  if [[ -z "$nextRoot" || -z "$nextBlockHex" ]]; then
    echo "no header from $endpoint" >&2
    exit 1
  fi

  nextBlock="$(cast to-dec "$nextBlockHex")"

  if [[ -z "$root" ]]; then
    root="$nextRoot"
    block="$nextBlock"
  elif [[ "$root" != "$nextRoot" || "$block" != "$nextBlock" ]]; then
    echo "endpoints disagree: $endpoint says $nextRoot #$nextBlock, first said $root #$block" >&2
    exit 1
  fi
done

echo "finalized root $root at #$block"
echo "feed $FEED_ADDRESS on $EVM_RPC"

cast send "$FEED_ADDRESS" "attest(bytes32,uint256)" "$root" "$block" \
  --rpc-url "$EVM_RPC" \
  --private-key "$ATTESTER_PRIVATE_KEY" \
  >/dev/null

echo "attested by $(cast wallet address --private-key "$ATTESTER_PRIVATE_KEY")"
