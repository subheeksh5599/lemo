# Finality: BeefyRootFeed

`contracts/BeefyRootFeed.sol` is an `IRootFeed` with no attester. A state root
lands only when Portaldot's own BEEFY validators have signed the block that
commits to it. Anyone may relay; nobody can choose what lands.

| Feed | Who decides the root | Trust |
|---|---|---|
| `RootFeed` | one attester key | the attester |
| `ThresholdRootFeed` | M of N attester keys | M attesters |
| `BeefyRootFeed` | Portaldot's BEEFY authorities (> 2/3 signatures) | the chain's own finality, plus one deploy-time checkpoint |

## What `submit` checks

```
submit(commitment, signatures, header, peaks, leafCount)
```

1. **Signatures.** `commitment` is the SCALE `Commitment { payload, block_number: u32, validator_set_id: u64 }`
   from a block's `BEEF` justification. Each 65 byte signature is checked with
   `ecrecover(keccak256(commitment))` and must map to a distinct member of the
   stored set. Unknown signers and repeated signers revert. At least
   `n - floor((n-1)/3)` are required, BEEFY's own threshold. With the current
   2 authorities, both must sign. `quorum()` returns that number.
2. **Set id.** `validator_set_id` must equal the stored set id.
3. **MMR root.** The `mh` payload entry (exactly one, 32 bytes) is the MMR root
   at commitment block N.
4. **Header and leaf.** The feed computes the MMR leaf itself from the header:
   `leaf = SCALE((u32 number, H256 blake2b256(header)))`, where `number` is the
   header's own compact block number and must be N-1. Leaf hash = keccak256.
5. **Newest-leaf MMR proof.** From the peaks before the append and the leaf
   count after it, the feed rebuilds the root and requires it to equal `mh`.
   The leaf merges with each peak to its left while the old leaf count has
   trailing one bits. The other peaks must be exactly one per remaining set
   bit. The peaks are then bagged right to left as `keccak(right || left)`.
6. **Monotonic.** The header number must be strictly greater than
   `currentBlockNumber`. Then `currentRoot = header.state_root` and
   `currentBlockNumber = N-1`.

A forged leaf can't stand in for an inner node. The leaf preimage is 36 bytes
and every inner node is 64 bytes.

## Facts measured on Portaldot V3 (test-node-v3, spec as of Nov 2026)

These come from probes and are checked again by `scripts/capture-beefy.mjs`
on every capture:

- **The MMR leaf is not the BEEFY-MMR leaf.** `Mmr::Nodes` peak hashes match
  `keccak256(SCALE((u32 parent_number, H256 parent_hash)))`, which is the generic
  `ParentNumberAndHash` leaf. No `beefy_next_authority_set` is in the leaf and
  no `leaf_extra`. The design changed because of this: rotation is proven
  from state (see below), not from the leaf.
- `Mmr::NumberOfLeaves` at block N is N. The newest leaf at N describes block N-1.
- Peak bagging: `keccak(right || left)`, folded right to left. This reproduces
  `Mmr::RootHash`, and `Mmr::RootHash` equals the signed `mh`.
- Justification encoding: `0x01` (V1) ++ commitment ++ compact signatures
  (signatures_from bitfield MSB-first, u32 set length, Vec<[u8;65]>). The
  recovery byte is 0/1, and the feed also accepts 27/28.
- Keyset commitment: `keccak(keccak(addr0) || keccak(addr1))`, i.e.
  `binary_merkle_tree` with no sorting. It matches `MmrLeaf::BeefyAuthorities.keysetCommitment`
  for the authorities' Ethereum addresses `0x4D13…B421` and `0x4A69…7413`.
- A set lasts 600 blocks. The first block of set k+1 is a mandatory block,
  and it is **signed by set k+1** (block 308066 was signed by set 519).
- The node keeps a BEEFY justification about every 8 blocks and serves
  archive state, so a relayer that falls behind can catch up from history.

## Which MMR path, and why

The feed uses **newest-leaf** proofs only. `mmr_generateProof` on the public
node returns `8011 LeafNotFound` for every leaf, including the newest. Leaves
and inner nodes live only in the offchain DB, and that node does not run with
offchain indexing. The on-chain `Mmr::Nodes` storage keeps exactly the peaks.
The peaks at N-1 plus the leaf of N-1 rebuild the root at N, and that is all
a root feed needs. If a node with offchain indexing appears later, a generic
MMR proof verifier could replace `_newestLeafRoot` without changing anything
else.

## Authority rotation

The set to rotate to is read from state. `rotate(next, nodes)`:

- proves the storage value `MmrLeaf::BeefyNextAuthorities`
  (key `0xda7d4185…af4643`, value `id u64 | len u32 | keyset_commitment`) under
  `currentRoot`, using the deployed `SubstrateTrieVerifier`;
- requires `id == validatorSetId + 1`, `len == next.length`, and that the
  `next` addresses merkle-hash to `keyset_commitment`;
- then installs set `id` (zero and duplicate addresses are rejected).

A root from any block of set k names set k+1. The feed therefore moves one
set per accepted root, **in order**: submit a block signed by k, rotate,
then submit blocks signed by k+1. `scripts/relay-beefy.mjs` plans this
catch-up automatically.

## Trust assumptions and limitations

- **Checkpoint on deploy (the one remaining trust assumption).** The
  constructor's `(validatorSetId, authorities)` is taken on trust. Anyone can
  check it against `beefy.validatorSetId`, `beefy.authorities` (compressed
  keys; address = last 20 bytes of keccak of the uncompressed key) and
  `mmrLeaf.beefyAuthorities` at a stated block, for example:
  `node scripts/capture-beefy.mjs block <N>`. That command prints
  `authorities.ethAddresses`, re-derived and checked against the keyset
  commitment.
- **Liveness depends on a relayer.** If nobody relays, the root goes stale.
  The gate then refuses proofs at newer roots, but it never accepts a wrong
  one.
- **Rotation must be relayed in order, at least once per set.** If nodes ever
  prune old justifications or state before a missed set is relayed, the feed
  cannot cross that gap and must be redeployed with a fresh checkpoint.
- **The validator set is the security.** Today BEEFY has 2 authorities, so
  "> 2/3" means both keys. The feed is exactly as strong as Portaldot's
  finality. It is not stronger.
- **Lag.** The root is the state of N-1 for a BEEFY block N. BEEFY itself
  trails GRANDPA by a few blocks.
- **Trusted code dependencies.** The hasher (`ReviveBlake2b256` → system
  precompile 0x900) and `SubstrateTrieVerifier` are fixed at construction.
  Both are existing LEMO contracts.
- **Why not GRANDPA.** GRANDPA signs with ed25519, and Revive has no ed25519
  precompile. BEEFY signs with secp256k1 over keccak, which `ecrecover` (0x01,
  verified to work on V3) checks directly.

## Size and cost

`forge build --sizes`: BeefyRootFeed **4,949 B initcode** (4,159 B runtime).
At about 0.078 tPOT/byte (0.06 deposit plus 30% lockup), that is roughly
386 tPOT plus fees. It needs the existing hasher and verifier. The constructor
was executed against the V3 EVM RPC with `eth_call` (no transaction) and
returned the runtime code. **Nothing has been deployed.**

## Scripts

```sh
# capture fixtures (each value cross-checked; aborts on any mismatch)
node scripts/capture-beefy.mjs latest              # test/fixtures/beefy-latest.json
node scripts/capture-beefy.mjs rotation            # beefy-rotation-pre/post.json around the last set change
node scripts/capture-beefy.mjs block 308060 out.json

# relay (dry run prints calldata; sends only with BOTH env vars set)
node scripts/relay-beefy.mjs
FEED_SET_ID=518 FEED_BLOCK=308000 RELAY_PLAN_OUT=plan.json node scripts/relay-beefy.mjs
FEED_ADDRESS=0x... RELAYER_PRIVATE_KEY=... node scripts/relay-beefy.mjs --once
```

The relayer's legacy EIP-155 signer produced a transaction byte-identical to
`cast mktx` for the same fields. Its `submit` calldata is byte-identical to
`cast calldata`. The sending path has not been run.

## Tests

`test/BeefyRootFeed.t.sol` uses only captured chain data:
`beefy-latest.json` (BEEFY block 308450, set 519),
`beefy-rotation-pre.json` (308060, set 518) and `beefy-rotation-post.json`
(308066, set 519). It covers:

- the exact root from a valid submission;
- `SubstrateTrieVerifier` proving System.Number = 308449 under the
  BEEFY-derived root;
- a missing signature, a duplicate, a foreign signer, a malformed signature;
- a tampered commitment (mh, block number, truncated), header (state root,
  digest, wrong block), peak, leaf count or dropped peak;
- a wrong set id, an older block or the same block again;
- the real 518 → 519 rotation, and its rejection for a swapped, foreign or
  short set and for a tampered proof;
- a TitleGateERC20 that mints only at the BEEFY root (the title verdict is
  mocked, because the V3 runtime has no LEMO pallet);
- a replay of the relayer's exact calldata (`beefy-relay-plan.json`).
