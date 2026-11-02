# LEMO proof service

**Status: working against Portaldot V3 Live.** Verified at finalized block **903809** on 2 Nov 2026:
the state root reproduced by this service matched the block header, every declared key resolved to
the same value the node reports through `state_getStorage`, and a rewritten state root was refused.

```text
28 tests, 0 failures  (27 offline, 1 live end-to-end)
```

This is the half of LEMO that has to exist before either contract face can check the other:
something that turns a title's chain records into a proof a third party can verify against a
block's own state root, without trusting the service that produced it.

## What it does

A LEMO title is a set of declared storage records — backing, owner, identity, vesting, revision.
The service reads those records at the **finalized** head, asks the node for a read proof, checks
that proof against the header's `stateRoot` before answering, and returns a package:

```text
finalized block { number, hash, parentHash, stateRoot }
keys             the declared storage keys, one per field
proof            the trie nodes the node returned
digest           blake2b-256 over the canonical package body
```

Anyone can re-run the verification: hashing the proof nodes must yield `stateRoot`, and walking the
key through those nodes must yield the record. A caller that re-verifies never has to trust this
process, the node, or the transport.

## The guarantee and its limits

Enforced here:

- a package only carries values that hash to the state root of the block it names;
- a package is bound to one chain genesis, one title, one block, and its own digest;
- the service refuses to answer with a proof it could not verify itself;
- a digest can be consumed once; the second attempt is refused by a primary key, not by a check.

Not enforced here, and not claimed:

- **the LEMO pallet does not exist yet.** The service is layout-driven, so it works on any declared
  key set today. The witness used in the tests is `System.Number` and `System.Account`, which are
  real chain records and prove the mechanism, not the protocol.
- no EVM-side counterpart, no on-chain verifier, no gossip transport. Proofs are served to a caller;
  deciding whether a transfer or an unlock is legal stays a contract job.
- the replay record is local to one instance. It records what this service handed out, not what the
  chain allowed.

## Run

```bash
npm install
LEMO_RPC_URL=https://live-v3-node.portaldot.dev LEMO_PORT=8080 npm start
```

| Variable | Default | Meaning |
|---|---|---|
| `LEMO_RPC_URL` | required | Portaldot V3 node (HTTP JSON-RPC) |
| `LEMO_PORT` | `8080` | listen port, loopback only |
| `LEMO_DB_PATH` | `lemo.db` | title and replay database |
| `LEMO_MIN_CONFIRMATIONS` | `0` | blocks required between a package block and head |
| `LEMO_MAX_KEYS` | `32` | fields allowed in one title |
| `LEMO_RPC_TIMEOUT_MS` | `10000` | per-call timeout |
| `LEMO_RPC_ATTEMPTS` | `3` | transport retries; RPC errors are never retried |

```bash
npm test            # offline suite (uses a captured live proof)
npm run test:live   # adds the end-to-end run against the node
npm run typecheck   # strict TypeScript, no emit
```

## Endpoints

| Route | Purpose |
|---|---|
| `GET /health` | chain identity, finalized head, EVM and statement-store capability, record counts |
| `GET /metrics` | Prometheus text: request counters, latency quantiles, title counts |
| `GET /openapi.json` | OpenAPI 3.1 document for every route below |
| `GET /titles` | registered title bindings |
| `POST /titles` | declare a title's storage layout and its EVM representation |
| `GET /titles/:id` | one binding |
| `GET /titles/:id/proof` | build, self-verify and return a package |
| `GET /titles/:id/transfer-check` | **Rule 1** — may the representation move on this title state |
| `GET /titles/:id/unbond-check` | **Rule 2** — may the native backing be unlocked |
| `GET /titles/:id/revisions` | accepted revision history, newest first |
| `POST /titles/:id/revisions` | accept the current revision and announce it on `lemo/<title_id>` |
| `POST /proofs/verify` | re-verify a package, decode every field, evaluate Rule 1 |
| `POST /proofs/consume` | mark a digest used; `409` on the second attempt |

Both rules answer with a list of named checks. A check that cannot be evaluated is a refusal
with its reason attached, never a pass: an unreadable EVM supply refuses Rule 2, and a field that
does not decode as declared fails the package.

## The rules, as the service evaluates them

Rule 1 (a representation may move) requires: the package verifies against its block state root,
the revision is at or above the accepted one, the package is at least `minConfirmations` deep,
every required record is present and decodable, the backing is non-zero, and identity status is
not cleared.

Rule 2 (backing may be unlocked) requires all of the above plus a **read** of the representation's
supply equal to zero. `unavailable` — no `eth_` namespace, no code at the address, a reverting
call — refuses, because "could not check" is not "nothing outstanding".

## The EVM face

`contracts/` holds the market side, deployed on Portaldot V3 Test:
`LemoTitle` at `0xc88763FA361669fC5d95c2BDD924b0E2872488bB` (title commitments, forward-only
revisions, per-title eligibility) and `LemoERC20Lite` at
`0x61c35d5e811b99f2641b43e9ef97e50d52de8ff7` (supply capped by the backing recorded at deployment,
no transfer while the title is ineligible). Addresses, transactions and measured costs are in
`contracts/DEPLOYMENTS.md`.

Measured on Portaldot V3 Test: the revive JSON-RPC pool rejects any transaction whose gas limit is
below `eth_estimateGas` (gas is weight-scaled — a plain transfer estimates around 5.1e11), and a
contract deployment estimates around 8.4e15, which fees at roughly 200 POT at the chain's base fee.
Funding an EVM address from the native account uses the mapper's padded account id
(`h160 ++ 0xEE×12`), verified by reading the balance back over `eth_getBalance`.


## Declaring a title

```json
{
  "titleId": "0xabab…ab",
  "label": "portaldot-finality-witness",
  "fields": [
    { "label": "revision", "pallet": "System", "item": "Number", "hasher": "identity", "args": [], "decode": "u32" },
    { "label": "owner", "pallet": "System", "item": "Account", "hasher": "blake2_128_concat",
      "args": [{ "type": "account32", "value": "0xfd66…0d" }], "decode": "bytes" }
  ]
}
```

`hasher` accepts the hashers the runtime metadata declares: `blake2_128`, `blake2_128_concat`,
`blake2_256`, `twox64`, `twox64_concat`, `twox256`, `identity`. `args` accepts `vec`, `account32`,
`hash32`, `u32`, `u64`, `u128`. `decode` accepts `bytes`, `u32`, `u64`, `u128`. Exactly one field is
named `revision`; it must decode as `u32` or `u64`, and it is what a verifier compares to reject a
package built against an older title state.

## Why the trie verification is written here

`state_getReadProof` returns nodes; it does not verify them. The trie is Portaldot's base-16
Merkle-Patricia layout with SCALE node headers, partial keys packed two nibbles per byte, branch
children addressed by a 16-bit bitmap, and blake2b-256 node hashes. That format is small enough to
implement exactly, and verifying it in-process is what makes this service's answer checkable:

- `src/trie/node.ts` decodes nodes;
- `src/trie/proof.ts` indexes nodes by their own hash, so only the root the node set encodes can be
  reached, and a missing node is reported as `PATH_INCOMPLETE` instead of being treated as absence;
- `test/fixtures/system-witness.json` is a package captured from the live chain, so the offline suite
  checks the real format, not a hand-built one.

## Files

```text
src/bytes.ts             hex and little-endian helpers
src/hashing.ts           blake2b-256/128, twox64/128/256, xxhash64
src/scale.ts             compact integers
src/trie/node.ts         node decoding
src/trie/proof.ts        root verification and key lookup
src/storage/layout.ts    storage key derivation and value decoding
src/proofs/package.ts    package build, canonical digest, verification
src/titles/model.ts      binding parsing and validation
src/service.ts           service layer
src/store.ts             titles and consumed digests (node:sqlite)
src/http/server.ts       routes
scripts/capture-fixture.ts  refresh the live fixture
scripts/smoke.mjs           manual end-to-end run against a running server
```
