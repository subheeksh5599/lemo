# Deterministic stress suite

Run with the rest of the server tests:

```sh
cd server && npm test
```

Every file in this directory is a real `node:test` suite. It imports the
production modules from `server/src` and the live-captured proof fixture from
`server/test/fixtures/portaldot-v3.json`. There are no mocks, no synthetic proof
sets, and no network calls. Node 26 runs the TypeScript directly.

## Determinism

All inputs come from mulberry32 streams derived from one fixed seed:

```
seed = 20261102 (0x13528ee)
```

Every run prints the seed and the stream label, for example
`[stress] mutation/D seed=20261102 (0x13528ee)`. Each part owns its own stream
(`seeded(1)` ... `seeded(6)`) so adding a case to one part cannot shift another
part's inputs. No `Math.random`, no clock, no filesystem state beyond the
checked-in fixture. A failing case name is reproducible on any machine.

## What is covered

### A. 300 SCALE compact length round-trips

For each case: `decode(encode(x)) === x`, `next === offset + encodedWidth`, the
byte after the field is untouched, bytes before the offset are ignored, the
input is not mutated, and re-encoding the decoded value reproduces the exact
bytes. Values cover 0, 1, 63, 64, 255, 16383, 16384, 0x3fffffff plus seeded
random values in all three inline SCALE modes. Offsets vary from 0 to 7 with
random prefix bytes, so a decoder that reads before its offset fails.

A separate check pins the spec bytes: `0x00`, `0x04`, `0xfc`, `0x0101`,
`0xfd03`, `0xfdff`, `0x02000100`, `0xfeffffff`.

### B. 200 negative compact and node cases

120 truncated compact fields (empty at the offset, missing second byte of the
mode 01 form, missing bytes of the mode 10 form), 40 big-integer mode 11 first
bytes, and 40 malformed node bodies (empty node with trailing bytes, partial key
past the end, non-zero pad nibble, truncated bitmap, zero-length child, short
hashed value reference, branch trailing bytes).

Each case asserts the thrown value is a `TrieDecodeError` with kind
`MALFORMED_NODE` and the exact message for its category. It does not assert
"some error was thrown".

### C. 200 storage-value u32 cases

160 little-endian u32 round-trips for `System.Number`, including 0, 1, 292815,
292863 and 0xffffffff, asserting the decoded number, `encoding === "u32-le"`,
no note, and agreement with the block number.

40 wrong-width blobs. Each must return `value: null` and the exact note
`expected 4 bytes for System.Number, got N`. A wrong-width blob must never be
reinterpreted as a shorter number.

The captured fixture is also checked against itself: its 4-byte storage must be
the little-endian u32 of its own block number.

### D. 200 trie mutations plus 10 unused-node probes

Each of the 200 cases flips exactly one byte in exactly one node of one of the
three live proofs (System.Number, System.Account, absent key), then runs the
real `verifyStorageProof` with the fixture's own storage as the claim.

Invariant asserted for every case:

> A tampered proof may be refused or may prove absence, but it may never return
> `present` with a value that differs from the fixture storage.

It also asserts that a byte flipped inside a node the untampered walk consumed
can never still verify as `present`, and that no mutation of the absent-key
proof can become `present`.

The outcomes are categorized as `status` or `status/error.kind` and printed with
counts. For this capture all 15 supplied nodes are consumed (193 flips on the
walk, 7 in the hashed value node), so the pure 200 produce no `present` case.
That is a property of a hash-addressed proof set: changing a node's bytes makes
it unreachable by its parent reference, so the verifier reports a missing node
rather than decoding corrupted content.

The separate 10-case probe appends a live node from the same block that the
target proof never references and flips one byte in it. The verifier correctly
returns `present` with the fixture value. This shows that an unused node is
counted as an accepted outcome rather than hidden or reported as corruption.

The suite does not claim that the 200 mutations explore malformed node decoding.
They cannot: the hash check runs before the decoder, so an unreachable mutated
node is never decoded. Part B covers malformed node bodies directly.

### E. 100 storage-key derivation checks plus one aggregate check

The live `System.Number` vector, `twox128(System)` and `twox128(Number)`
vectors, 16-byte prefix widths, prefix/item layout, `System.Account` prefix,
`Blake2_128Concat` reconstruction of the captured account key, determinism,
order sensitivity, and the fact that twox128 is not blake2-128.

80 seeded pallet/item pairs each check key length (32 bytes), both prefix
lengths (16 bytes), prefix placement, agreement with `palletItemKey`, and
distinctness from `System.Number`. One aggregate check asserts all 80 keys are
unique.

## Test count

The suite contributes 1000+ named subtests plus aggregation checks. The exact
count is whatever `npm test` prints in its `tests`/`pass`/`fail` summary. No
case is padded with `assert.ok(true)`; every subtest checks a distinct input or
a distinct derived invariant.

## What this proves

- The compact-length decoder agrees with an independent SCALE encoder at every
  mode boundary and across seeded random values, including exact offsets.
- Truncated, big-integer and malformed node bodies fail closed with specific,
  machine-readable errors.
- `System.Number` is decoded as a 4-byte little-endian u32, and every other
  width is refused with a note instead of a plausible wrong number.
- Mutating the live proof never produces `present` with a changed value.
- Storage keys are derived with `twox128` prefixes of the right width and are
  unique for distinct pallet/item pairs.

## What this does not prove

- It is not an on-chain test. Nothing here submits an extrinsic, calls a node,
  or checks consensus. It exercises the decoder against one captured response
  from one finalized block.
- It is not a substitute for deployment verification. A green run here does not
  show that the service is reachable, that the RPC endpoint behaves, or that the
  contracts on the testnet enforce Rule 1 or Rule 2.
- One fixture is one sample. It pins the encoding shape seen at block 292863 on
  Portaldot V3, state root
  `0x90d67ea567eb62e8df58d4bed6f0e66329f547ad75be215caa66f4abde60cbe5`,
  block number 292863, `System.Number` storage `0xff770400`. It does not
  generalize to other chains, other trie layouts, or states where the value is
  stored as its own node.
- Random values come from a seeded PRNG, so they are reproducible but not
  exhaustive. They do not replace a proof of correctness.
- Mutation cases that hit a node the walk did not use are counted as accepted
  outcomes (see part D). They are not evidence of tamper detection.
