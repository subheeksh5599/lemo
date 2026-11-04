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
  no `leaf_extra`, so the next authority set cannot come from the leaf.
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

Portaldot's BEEFY set id advances every 600 blocks, but the membership has
not changed: `MmrLeaf::BeefyNextAuthorities.keysetCommitment` equals the
current one (both are the two keys `0x4D13…B421` and `0x4A69…7413`). The feed
therefore follows rotations **implicitly**: `submit` accepts a commitment for
the stored set id or for stored + 1, signed by more than 2/3 of the stored
keys, and on stored + 1 it advances `validatorSetId` (event `SetAdvanced`).

- A jump of more than one set id is refused, so sets are walked in order,
  one accepted root per set. `scripts/relay-beefy.mjs` plans this catch-up:
  from set 518 it walked 15 sets in order against the live chain
  (`test/fixtures/beefy-relay-plan.json`, replayed in `forge test`).
- If the real membership ever changes, the stored keys can no longer reach
  the threshold. The feed stalls: it fails closed and never accepts a root
  the stored keys did not sign. A membership change needs a new deployment
  with a new checkpoint.

An earlier version proved the next set from state with a `rotate()` call
through `SubstrateTrieVerifier`. It worked against the real 518 → 519 change,
but it cost 98 tPOT more to deploy than the deployer wallet held, so it was
removed. It can come back as a separate contract if membership starts to
change.

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
  prune old justifications before a missed set is relayed, the feed cannot
  cross that gap and must be redeployed with a fresh checkpoint.
- **Membership is fixed at deploy.** The stored keys are trusted to sign BEEFY
  commitments only for blocks GRANDPA finalized, which is what BEEFY
  validators do. A membership change stalls the feed (see above).
- **The validator set is the security.** Today BEEFY has 2 authorities, so
  "> 2/3" means both keys. The feed is exactly as strong as Portaldot's
  finality. It is not stronger.
- **Lag.** The root is the state of N-1 for a BEEFY block N. BEEFY itself
  trails GRANDPA by a few blocks.
- **Trusted code dependency.** The hasher (`ReviveBlake2b256` → system
  precompile 0x900, the existing LEMO contract `0x15ae…7e22`) is fixed at
  construction.
- **Why not GRANDPA.** GRANDPA signs with ed25519, and Revive has no ed25519
  precompile. BEEFY signs with secp256k1 over keccak, which `ecrecover` (0x01,
  verified to work on V3) checks directly.

## Deployment

| | |
|---|---|
| Address | `0x0ec209f0a45d65215a59e6bce135344b16316937` ([mapped account](https://scanner-testnet-v3.portaldot.dev/#/accounts/5CQ4AmAf4KEWnSHwu72VzF8SYVBWk4t66jRsYWXwEyf3rzWv)) |
| Size | 3,591 B initcode, 2,898 B runtime (`forge build --sizes`) |
| Storage deposit | 254.52 tPOT, measured first with a `ReviveApi_instantiate` dry run (`scripts/dry-run-deposit.mjs`) |
| Checkpoint | validator set 533, authorities `0x4d13b6ae…b421`, `0x4a69b8f7…7413`, read from `beefy.validatorSetId` / `beefy.authorities` at deploy |
| Deployer | `5FJ9YMZwMuqDpmD5Y6xTje2vEN3UcMaMcVs9ptSDqJSkshCz` through `revive.instantiateWithCode`, extrinsic [316946-1](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/316946-1) |
| First root | BEEFY block #316946 → state root `0xaea5aa9b…de80f` of [#316945](https://scanner-testnet-v3.portaldot.dev/#/blocks/316945), submitted natively (`scripts/native-call.mjs`, extrinsic [316958-1](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/316958-1)); first write reserved 11.52 tPOT of storage, fee 0.118 tPOT |
| First relayer root | BEEFY block #316970 → `0x9dc45328…1475a3` of [#316969](https://scanner-testnet-v3.portaldot.dev/#/blocks/316969), EVM tx `0x85df9d1f…3577a9` from relayer `0xf6b667b0…c75a` |

Each later submit overwrites the same slots: about 0.12 tPOT in fees per
set, so ~2.9 tPOT a day keeps the root current.

The relayer account `0xf6b667b0…c75a` (native `5HeBperF6m5AbP8TZKPnYRdBPMHNK3ebgkDH7FpPHNPBM9y1`) holds 106.76 tPOT, about five weeks of hourly relaying.

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

### Scheduled relayer

`.github/workflows/relay-beefy.yml` runs `node scripts/relay-beefy.mjs --once`
hourly at minute 7 (and on `workflow_dispatch`) on Node 22 after
`npm ci --ignore-scripts`. The job is skipped while the repository variable
`FEED_ADDRESS` is empty, so it does nothing until a feed exists. To enable it:

1. Deploy `BeefyRootFeed` and record the address in `docs/EVIDENCE.md`.
2. Settings → Secrets and variables → Actions → Variables: set
   `FEED_ADDRESS` to the feed's 0x address.
3. Secrets: set `RELAYER_PRIVATE_KEY` to a 0x secp256k1 key whose EVM account
   holds tPOT for gas (fund its mapped SS58 account, see
   `scripts/evm-native-address.mjs`). The key only pays gas; it cannot choose
   a root.
4. Run the workflow once by hand and read the log: each round prints the
   planned `submit` calls and the sent hashes.

A set lasts 600 blocks (about an hour), so an hourly run usually submits one root; a late run walks the missed sets in order. It is enabled: `FEED_ADDRESS` is set and `RELAYER_PRIVATE_KEY` holds a dedicated key that only pays gas.
With the secret missing the job fails instead of running a silent dry round.

The console page `/console/finality` re-runs the same checks in the browser
against the newest BEEFY block, and, with `NEXT_PUBLIC_LEMO_BEEFY_FEED` set,
compares the feed's `currentRoot` with the header of `currentBlockNumber`.

The relayer's legacy EIP-155 signer produced a transaction byte-identical to
`cast mktx` for the same fields. Its `submit` calldata is byte-identical to
`cast calldata`. The sending path has since run against the live feed (above).

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
- the real 518 → 519 set change followed implicitly, a set-id jump of two
  refused, a next-set commitment refused with an unstored key or one
  signature;
- a TitleGateERC20 that mints only at the BEEFY root (the title verdict is
  mocked, because the V3 runtime has no LEMO pallet);
- a replay of the relayer's exact calldata across 15 real set changes (`beefy-relay-plan.json`).
