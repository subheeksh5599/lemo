# LEMO Security Audit

**Subject:** `lemo` — EVM title gates, Substrate trie verifier, root feeds, native `lemo-title` pallet, and the wallet / proof-service boundaries
**Commit:** `f8f3633` (working tree, 2026-11-02)
**Method:** Pashov Audit Group methodology (`solidity-auditor` / `x-ray`: invariant-first review, one exploit path per lead, severity by impact × likelihood, no deployer-intent reasoning) plus the local `security-review` checklist for the TypeScript/server/wallet surface
**Status:** read-only audit. No code was modified, nothing was deployed, `.env.local` was not read.

**Remediation in the working tree after this report:** C-01 is **mitigated, not fully fixed**: an immutable global `maxSupply` bounds the damage, but there is still no amount-to-record binding. C-02 (burn caller restriction to the holder), H-01 (state-root removed from the action nullifier; action parameters added), H-02 (mint bound to the proven owner), H-03 (release re-checks `representationOutstanding`), H-04 (one open request per title), H-05 (unwritten liveness is now fail-closed), H-08 (zero-recipient mint refused) and M-08 (ERC-165) are addressed, with 90 Foundry and 10 pallet tests passing. H-01 is narrowed, not eliminated: a distinct action at the same revision still gets its own nullifier, so a true per-revision spend counter remains the correct long-term fix. H-06 is addressed in the working tree: `CanonicalTitles` is a 320-byte blob and the native record carries an explicit `evm_beneficiary`, so the EVM decoder no longer reads a truncated `AccountId32`. H-07 and the Medium/Low findings below remain open.

**Baseline:** `forge test --summary` → 83 passed, 0 failed (Blake2b 5, FailureInjection 20, LemoTitle 13, SubstrateTrieVerifier 16, ThresholdRootFeed 12, TitleGate 17). Every finding below is either uncovered by those tests or is a property the tests assert only for a single root.

## Severity summary

| ID | Severity | Title | Primary location |
| --- | --- | --- | --- |
| C-01 | Critical | ERC-20 `mint` has no supply cap and no binding on `to` or `amount`; one public mint proof mints unlimited supply | `contracts/TitleGateERC20.sol:87-90`, `:125-130` |
| C-02 | Critical | ERC-20 `burn` is permissionless over `from` — any burn proof destroys any holder's balance | `contracts/TitleGateERC20.sol:94-97`, `:132-141` |
| H-01 | High | Gated authorisation is root-scoped, not revision-scoped: the same proof authorises one action **per new root** | `contracts/TitleGateBase.sol:148`, `:157-162` |
| H-02 | High | Mint is not bound to the proven native owner — a mint proof is a bearer cheque, front-runnable | `contracts/TitleGateERC721.sol:59-66`, `contracts/TitleGateERC20.sol:87-90` |
| H-03 | High | `UnbondGuard.completeUnbond` does not re-check `representationOutstanding()` → burn → request → re-mint → release | `contracts/UnbondGuard.sol:86`, `:114-119` |
| H-04 | High | Multiple concurrent pending unbond requests for one title (id keyed by root/revision) → repeated release | `contracts/UnbondGuard.sol:106-108` |
| H-05 | High | Native Rule 2 is fail-open: `RepresentationLive` defaults to `false` and is admin-written only | `pallets/lemo-title/src/lib.rs:52-53`, `:183-193` |
| H-06 | High | Pallet storage encoding and EVM decoder are incompatible and unenforced (SCALE 260 B / `AccountId32` vs fixed 320 B / `H160`) | `contracts/LemoTitle.sol:48`, `:93-115`; `pallets/lemo-title/src/lib.rs:22-33` |
| H-07 | High | `RootFeed` is a single, non-monotonic, instantly rotatable key — and `Deploy.s.sol` falls back to it unless `THRESHOLD` is set (any value ≥ 1 accepted) | `contracts/RootFeed.sol:67-73`, `:95-100`; `script/Deploy.s.sol:72-82` |
| H-08 | High | ERC-721 `mint` to `address(0)` bricks the token and permanently blocks native unbond | `contracts/TitleGateERC721.sol:59-66`, `:173` |
| M-01 | Medium | Verifier never binds `proof.storageKey` to `proof.titleId` (no canonical-key / pallet-prefix check) | `contracts/SubstrateTrieVerifier.sol:129-150` |
| M-02 | Medium | `ThresholdRootFeed`: no vote revocation, no expiry, no attester rotation, no independence check | `contracts/ThresholdRootFeed.sol:24-32`, `:69-88` |
| M-03 | Medium | `setTitleCommitment` accepts any non-zero value with no delay; owner `pause` freezes transfers **and** burns | `contracts/TitleGateBase.sol:116-127` |
| M-04 | Medium | Proof service: no rate limit or auth on `/v1/verify/native`, `access-control-allow-origin: *`, unbounded hex lengths | `server/src/app.ts:42`, `:51`, `:159-171`; `server/src/schemas.ts:9-12` |
| M-05 | Medium | RPC URLs (potential API keys) are returned publicly and echoed in deploy logs | `server/src/schemas.ts:150`, `:168`; `script/Deploy.s.sol:59` |
| M-06 | Medium | Pallet calls are priced at a flat `10_000` ref_time over `#[pallet::unbounded]` storage with no deposit; `create_title` lets anyone squat a `title_id` | `pallets/lemo-title/src/lib.rs:93-123` |
| M-07 | Medium | `request_unbond` deletes the title in one step — no tombstone, no delay — stranding any outstanding representation forever | `pallets/lemo-title/src/lib.rs:183-193` |
| M-08 | Medium | ERC-721 has no ERC-165 `supportsInterface` — not a conforming ERC-721 | `contracts/TitleGateERC721.sol` (whole file) |
| M-09 | Medium | Wallet layer trusts unauthenticated EIP-6963 announcements and unvalidated SS58 strings | `lib/wallet/eip6963.ts:83-106`; `lib/wallet/substrate.ts:81-102` |
| L-01 | Low | `setTitleCommitment` reverts `ZeroAddress()` for a zero commitment; `ZeroCommitment` declared but unused | `contracts/TitleGateBase.sol:88`, `:117` |
| L-02 | Low | `UnbondGuard` dead/incoherent constants (`OP_UNBOND`, `REQUIRED_PROOF_OPERATION`), `requestBlock` written and never read, no expiry or cancel | `contracts/UnbondGuard.sol:28-29`, `:108` |
| L-03 | Low | `ReviveBlake2b256`: unused `STATIC_CALL_GAS`, uncapped `staticcall` gas, chain-specific precompile address assumed | `contracts/ReviveBlake2b256.sol:31`, `:37-42` |
| L-04 | Low | `LemoTitle`: single-EOA writer with no two-step transfer, unused `TitleIdIsImmutable`, records never deletable | `contracts/LemoTitle.sol:133-173` |
| L-05 | Low | Verifier: hashed-value lookup lacks the cycle check its sibling has; duplicate-hash node ambiguity | `contracts/SubstrateTrieVerifier.sol:344-347` vs `:305-317` |
| L-06 | Low | Deploy script permits `THRESHOLD=1`, prints the RPC URL, and leaves an immutable, non-transferable gate owner | `script/Deploy.s.sol:59`, `:72-82`, `:94-102` |
| L-07 | Low | ERC-20 `transferFrom` to self is not rejected (only `transfer` rejects it) yet consumes proof and allowance | `contracts/TitleGateERC20.sol:56`, `:64-83` |
| L-08 | Low | Frontend accepts arbitrary icon URLs and ships no CSP | `components/wallet/wallet-menu.tsx:47-58`; `next.config.ts` |
| L-09 | Low | Verifier's `reached[]` is never checked, so a supplied node that no reference reaches is accepted (contradicts its own docstring) | `contracts/SubstrateTrieVerifier.sol:59-61`, `:226-247` |

## Trust model used for severity

The audit assumes the deployed configuration described by `docs/DEPLOYMENT.md`: `ReviveBlake2b256` → `SubstrateTrieVerifier` → 2-of-3 `ThresholdRootFeed` → `TitleGateERC20`. Where a finding depends on the single-attester fallback it is stated. The native pallet is source-only (`pallets/lemo-title/src/lib.rs:8-9`), so pallet findings are rated as integration risk, not live loss.

In scope: `contracts/*.sol`, `pallets/lemo-title/src/lib.rs`, `script/Deploy.s.sol`, `server/src/*`, `lib/wallet/*`, `components/wallet/*`, `scripts/evm-native-address.mjs`.
Out of scope: `test/lib/forge-std`, `node_modules`, the untracked `lib/flow/` directory, Portaldot's `pallet-revive` precompile implementation, and the native chain's finality rules.

---

## Critical

### C-01 — ERC-20 `mint` mints unlimited supply from one mint proof

`contracts/TitleGateERC20.sol:87-90`

```solidity
function mint(address to, uint256 amount, ITitleVerifier.TitleProof calldata proof) external {
  _gate(OP_MINT, proof);
  _mint(to, amount);
}
```

`_gate` (`contracts/TitleGateBase.sol:132-166`) binds chain, title id, token, operation, revision, root and commitment. It binds **nothing** about `to` or `amount`. `TitleRecord` (`contracts/LemoTitle.sol:11-22`) has no amount or supply field, and `_mint` (`contracts/TitleGateERC20.sol:125-130`) only increments `totalSupply` — there is no cap, no `maxSupply`, no backing-scale check.

**Exploit path**

1. Any valid `OP_MINT` proof is public data: it is either in the mempool of the deploy/mint transaction or can be rebuilt by anyone from `state_getReadProof` at the feed's current root for the title's storage key (the service itself exposes this: `server/src/app.ts:149-171`).
2. Attacker calls `mint(attacker, type(uint256).max, proof)` — or any amount — to themselves. `_gate` passes: the record is backed and identified, revision and commitment match, root matches.
3. Because the nullifier includes `proof.stateRoot` (`contracts/TitleGateBase.sol:157-159`) and the feed publishes a new root every finalized block, the *same* proof is valid again as soon as the root advances (see H-01). The attacker re-fetches the node set at each new root — no secret, no signature, no permission.
4. Result: unbounded inflation of a token that is presented as a 1:1 representation of native backing. `representationOutstanding()` stays true, so it also pins native unbonding forever (M-07 / H-05 interaction).

**Fix**

- Bind supply to the record. Add `supply` (or `amount`) to the committed record and require `amount` to equal the delta the record authorises; require `totalSupply + amount <= record.supply`.
- Bind the recipient: decode the record in the gate (`_gate` already returns it — `:134`, `:165`) and require `to == record.owner` (mapped through the documented account mapping) or an explicit native-signed beneficiary field.
- Make the mint nullifier revision-scoped (H-01) so a mint cannot be repeated without a new native revision.
- Add `require(to != address(0))`.

### C-02 — ERC-20 `burn` destroys any holder's balance

`contracts/TitleGateERC20.sol:94-97`

```solidity
function burn(address from, uint256 amount, ITitleVerifier.TitleProof calldata proof) external {
  _gate(OP_BURN, proof);
  _burn(from, amount);
}
```

There is no `msg.sender == from`, no allowance check, no operator concept. Contrast the ERC-721 variant, which does check holder/operator (`contracts/TitleGateERC721.sol:70-74`).

**Exploit path**

1. Obtain any `OP_BURN` proof for the title (public, as in C-01).
2. Call `burn(victim, victimBalance, proof)`. `_burn` (`:132-141`) checks only that `from` has the balance.
3. Repeat for every holder and for every new root (H-01). `totalSupply` collapses to zero, which additionally flips `representationOutstanding()` to false and unlocks native unbonding (H-05) while the attacker keeps the destroyed-against holders' native claim.
4. Also reachable accidentally: a legitimate burn proof handed to a relayer can be re-pointed at a different `from`.

**Fix**

```solidity
function burn(address from, uint256 amount, ITitleVerifier.TitleProof calldata proof) external {
  if (msg.sender != from && !isApprovedForAll[from][msg.sender]) revert NotAuthorised(...);
  _gate(OP_BURN, proof);
  _burn(from, amount);
}
```
Add the operator map, bind `amount` to the authorised record delta, and scope the nullifier to the revision.

---

## High

### H-01 — Authorisation is per-root, so every gated action is repeatable once per block

`contracts/TitleGateBase.sol:148` and `:157-162`

```solidity
if (proof.revision < acceptedRevision) revert RevisionStale(proof.revision, acceptedRevision);
...
bytes32 nullifier = keccak256(abi.encode(titleId, proof.revision, operation, proof.stateRoot, address(this)));
...
acceptedRevision = proof.revision;
```

The nullifier is keyed on the state root, and `proof.revision` may **equal** `acceptedRevision` (`<`, not `<=`). A state root changes every finalized block while a record stays at the same revision (the pallet only bumps on owner edits — `pallets/lemo-title/src/lib.rs:151-154`, `:219-222`). Therefore the pair (revision, operation) is re-authorisable at every root.

**Exploit path**

1. Record at revision 1 is unchanged for N blocks. The feed accepts a new root each block.
2. At each root, the same proof *semantics* (same storage key, same record, same operation) yields a different nullifier and is accepted again.
3. This directly falsifies the documented invariant "the same proof cannot authorise a second state change" (`contracts/TitleGateBase.sol:28-29`) and the test that asserts it (`test/TitleGate.t.sol:238-260`) — that test never advances the root between the two calls.
4. Enables C-01/C-02 and makes ERC-721 transfers replayable at the same revision (harmless for value, but it means the revision counter is not a spend counter).

**Fix**

Use the revision as the spend counter and drop the root from the nullifier:

```solidity
bytes32 nullifier = keccak256(abi.encode(titleId, proof.revision, operation, address(this)));
if (proof.revision <= acceptedRevision) revert RevisionStale(proof.revision, acceptedRevision);
```
If one revision legitimately needs several actions (e.g. many ERC-20 transfers), then the native record must carry an explicit per-action nonce/counter that the gate consumes, and that counter must be part of the commitment.

### H-02 — Mint is not bound to the proven owner; the proof is a bearer cheque

`contracts/TitleGateERC721.sol:59-66`, `contracts/TitleGateERC20.sol:87-90`

`mint(to, proof)` accepts any `to`; `_gate` returns the decoded record (`contracts/TitleGateBase.sol:134-165`) and both callers discard it.

**Exploit path** — attacker watches the mempool (or the proof service logs) for the legitimate `mint(owner, proof)`; front-runs with the identical proof and `to = attacker`. First call wins because ERC-721 has a single `TOKEN_ID` (`:60`), so the legitimate mint reverts with `TokenExists`. For ERC-20 the attacker mints to themselves and the victim's transaction also succeeds with the same proof (different nullifier only if the root changed).

**Fix** — decode in the gate and bind: `TitleRecord memory r = _gate(OP_MINT, proof); if (mappedAddress(r.evmOwnerOrOwner) != to) revert RecipientNotProven();`. This requires the record to carry an EVM-reachable recipient (see H-06 for why `record.owner` cannot be used as-is today). Commit-and-reveal is not needed once the recipient is inside the commitment.

### H-03 — Unbond release is a TOCTOU against `representationOutstanding()`

`contracts/UnbondGuard.sol:86` (check) vs `:114-119` (release)

```solidity
function requestUnbond(...) external returns (bytes32 id) {
  if (representation.representationOutstanding()) revert RepresentationOutstanding();
  ...
}
function completeUnbond(bytes32 id) external {
  if (msg.sender != attester) revert NotAttester();
  if (requestState[id] != State.PENDING) revert RequestNotPending(id);
  requestState[id] = State.RELEASED;
```

The only Rule-2 check happens at request time. Nothing re-checks supply at release time, and the release is decoupled (could be minutes or days later, and in the intended flow it is a separate native-side action).

**Exploit path**

1. Holder burns the ERC-20 representation with a valid `OP_BURN` proof → `totalSupply == 0` → `representationOutstanding()` false.
2. `requestUnbond(burnProof)` succeeds; a pending request exists (`:107`).
3. Representation is minted again at the *same revision* — permitted because mint's nullifier is `OP_MINT` while the guard's is `OP_UNBOND` (`:100-102`), and both accept `revision == acceptedRevision` (H-01, C-01). Supply is now non-zero again.
4. Attester calls `completeUnbond(id)` → native backing is released **while an EVM representation of the same title is live**. Value is now claimed twice: released collateral plus spendable ERC-20 supply.

**Fix** — re-check at release, and make release conditional on a fresh proof, not on a flag captured earlier:

```solidity
function completeUnbond(bytes32 id) external {
  if (msg.sender != attester) revert NotAttester();
  if (requestState[id] != State.PENDING) revert RequestNotPending(id);
  if (representation.representationOutstanding()) revert RepresentationOutstanding();
  requestState[id] = State.RELEASED;
```
Pair this with C-01/H-01 fixes; without a supply cap a re-mint is always one root away.

### H-04 — Several pending unbond requests can exist for one title

`contracts/UnbondGuard.sol:106-108`

```solidity
id = keccak256(abi.encode(titleId, proof.revision, OP_UNBOND, proof.stateRoot));
requestState[id] = State.PENDING;
```

The id embeds revision and root, but the business object is *the title* (`titleId` is immutable, one title per guard — `:78-79`). Two proofs at different revisions or roots produce two ids, both `PENDING`, both releasable. There is no `requestedForTitle` map and no check that the title has no open request.

**Exploit path** — after a first release is queued, submit a second `requestUnbond` with an older-but-current-root proof at a different revision; the attester (or an automated release job keyed by request id) releases twice against one title. Whether the native side double-pays depends on the release implementation, which is not in this repository — that is precisely why the contract must enforce "at most one unbond per title".

**Fix** — key lifecycle state on `titleId`, reject when `requestState[titleId] != NONE`, and store the revision/root as metadata only.

### H-05 — Native Rule 2 is fail-open

`pallets/lemo-title/src/lib.rs:52-53`, `:183-193`

```rust
pub type RepresentationLive<T: Config> = StorageMap<_, Blake2_128Concat, T::Hash, bool, ValueQuery>;
...
pub fn request_unbond(origin: OriginFor<T>, title_id: T::Hash) -> DispatchResult {
  ensure!(record.owner == who, Error::<T>::NotOwner);
  ensure!(!RepresentationLive::<T>::get(title_id), Error::<T>::RepresentationLive);
  Titles::<T>::remove(title_id);
```

`ValueQuery` means an unset key reads `false` = "not live". The flag is written only by `AdminOrigin` (`:168-178`), i.e. by an off-chain observer. Every failure mode of that observer — not yet wired, restart, RPC outage, deploy ordering — reads as "no representation" and allows the native owner to unbond and delete the record.

**Exploit path** — create a title, mint the ERC-20 representation (C-01 makes this trivial), never have the admin set the flag (or wait for a window where it is stale), call `request_unbond` from the native owner. Backing releases while supply is outstanding; from that moment the record is deleted and no EVM proof for it can ever be produced again, so the representation is unbacked and unburnable-with-proof.

**Fix** — invert the default: `pub type RepresentationLive<T> = StorageMap<_, Blake2_128Concat, T::Hash, bool, ValueQuery>` → a `RepresentationState` enum defaulting to `Unknown`/`Live`, and `request_unbond` requires `Some(false)` explicitly plus a delay (`UnbondingPeriod`), cancellable, mirroring `UnbondGuard`'s two-phase design. Better: derive it from a verified cross-chain message rather than an admin write.

### H-06 — Pallet encoding and EVM decoder are incompatible, and nothing enforces the boundary

`contracts/LemoTitle.sol:48`, `:93-115`; `pallets/lemo-title/src/lib.rs:22-33`

`TitleLib.decodeNative` requires exactly `NATIVE_RECORD_BYTES = 320` bytes: ten 32-byte words, with `owner` and `evmContract` required to fit in 160 bits (`:100`, `:107`).

The pallet stores a struct derived with `Encode`/`Decode`:

| Field | Pallet SCALE | EVM decoder expects |
| --- | --- | --- |
| `title_id` | 32 | 32 |
| `chain_id` | **8** (`u64`) | 32 |
| `native_asset`…`permissions_hash` | 32 each | 32 each |
| `owner` | **32** (`AccountId32`) | 32, but **must have zero high 96 bits** |
| `evm_contract` | **20** (`[u8; 20]`) | 32 |
| `revision` | **8** (`u64`) | 32 |
| total | **260** | **320** |

`docs/NATIVE_REGISTRY.md:27-30` states the pallet "stores the same fields so a runtime API can expose that fixed width record" — but no such runtime API exists in this repository, and no test or assertion checks that the two encodings agree. As written:

- decoding the raw storage value returns `INVALID` for every record (length 260 ≠ 320) → the gate rejects every real proof;
- even a re-encoded 320-byte runtime API cannot represent an `AccountId32` owner: `ownerWord >> 160 != 0` is true for *all* native accounts, so `decodeNative` returns `false`;
- the bridge between the two account models is the undocumented-in-code `H160 ++ 0xEE*12` mapping (`scripts/evm-native-address.mjs:4-6`, `docs/DEPLOYMENT.md:18-24`), which no contract verifies. If Portaldot changes the mapper (or the same code is pointed at another Revive chain), the SS58 address in the record stops corresponding to the EVM signer with no on-chain signal.

Impact is fail-closed (no forged value), so this is not a theft vector, but it makes the end-to-end path non-functional and hides a real account-mapping assumption inside a string in a shell script.

**Fix** — define one canonical encoding with a shared vector set consumed by both sides (the repo already has `test/fixtures`; extend it), add a pallet runtime API `title_record_fixed_width(title_id) -> [u8; 320]` that is unit-tested against the Solidity decoder, carry the EVM beneficiary as an explicit `[u8; 20]` field in the record (do not truncate `AccountId32`), and assert the mapping version on-chain (e.g. a `mapperVersion` in the commitment domain) so a chain upgrade cannot silently remap owners.

### H-07 — Single, non-monotonic, instantly rotatable root source is the default

`contracts/RootFeed.sol:67-73`, `:95-100`; `script/Deploy.s.sol:72-82`

```solidity
function attest(bytes32 root, uint256 blockNumber) external onlyAttester {
  ...
  currentRoot = root;
  currentBlockNumber = blockNumber;   // no monotonicity, no pin required
```

The contract documents its own weaknesses (`:11-28`), which is good, but the gate has no way to tell which feed it got, and `Deploy.s.sol` silently degrades:

```solidity
uint256 threshold = vm.envOr("THRESHOLD", uint256(0));
if (threshold == 0) { rootFeed = new RootFeed(vm.envAddress("ATTESTER")); }
else { ... new ThresholdRootFeed(attesters, threshold); }
```

`.env.deploy.example` sets `THRESHOLD=2`, but a missing or zero value deploys the single-key feed, and `ThresholdRootFeed` itself accepts `threshold_ == 1` (`contracts/ThresholdRootFeed.sol:52-54`), which is indistinguishable in effect from `RootFeed` while carrying a "quorum" name. `setAttester` has no delay and no two-step handshake, so one compromised owner key swaps the root source at will; `setOwner` (`:102-106`) then makes it permanent.

**Exploit path** — a single attester key (or an owner who rotated to their own key) publishes a root of a fork or an older block whose record still says `revision = N, backing = X, evmContract = token`. The gate accepts it (it only compares to `currentRoot`), the proof authorises a transfer/mint/burn for a state that never finalized, and — with H-01 — the attacker can alternate between two roots to repeat actions.

**Fix** — refuse to deploy without an explicit feed choice (`require(threshold >= 2)` and `attesters.length >= 3` in the deploy script, or a required `FEED_MODE`), enforce `blockNumber > currentBlockNumber` and a max drift (`blockNumber <= current + N`) in `RootFeed`, add `proposeAttester`/`acceptAttester` with a delay, and surface the mode to the gate (`IRootFeed.mode()` — `contracts/IRootFeed.sol:5-9` currently exposes no such property, so a consumer cannot assert it got a quorum feed).

### H-08 — ERC-721 `mint` to `address(0)` bricks the token and the native title

`contracts/TitleGateERC721.sol:59-66`; the zero-recipient check exists only in `_transfer` (`:173`), not in `mint`.

```solidity
if (_ownerOf[TOKEN_ID] != address(0)) revert TokenExists(TOKEN_ID);
_gate(OP_MINT, proof);
totalSupply = 1;
_ownerOf[TOKEN_ID] = to;           // to may be address(0)
```

**Exploit path** — mint with `to = address(0)`. `_ownerOf[1]` stays `0`, so:
- `ownerOf(1)` reverts `NoSuchToken` (`:137-141`) — nobody can ever hold or transfer it;
- `burn` reverts `NoSuchToken` (`:164-167`) — it can never be destroyed;
- `totalSupply` stays `1`, so `representationOutstanding()` is permanently `true` (`:158-160`) and native unbonding is permanently refused (H-05/M-07);
- `TokenExists` does not trip, so the mint can be repeated to keep re-consuming proofs.

This is a permanent, permissionless griefing of a title's liveness. **Fix:** `if (to == address(0)) revert UnsafeRecipient(to);` at the top of `mint` (and `_mint` in the ERC-20 variant).

---

## Medium

### M-01 — The verifier never binds the storage key to the title

`contracts/SubstrateTrieVerifier.sol:129-150`

`proof.storageKey` is used only to drive the walk (`:136`). The decoded record is then checked against `proof.titleId`, `revision`, `chainId`, `token` and the commitment (`:142-147`), but nothing asserts that the key is the canonical `Title` storage key for that title id (twox128 pallet prefix + `Blake2_128Concat(titleId)`), or even that it lies in the `LemoTitle` prefix.

Given a commitment that names a record, an attacker can supply a proof of that same record bytes-value at *any* key the chain commits — an index entry, a migration scratch key, an older duplicate under a renamed prefix. Integrity still holds (the value is root-committed), so this is not forgery; it is a proof of location that is not verified, which breaks the "the title exists at its canonical location" claim and will silently survive storage-layout migrations that are supposed to change where authoritative data lives.

**Fix** — recompute the expected key inside the verifier from `proof.titleId` and a frozen layout constant, and require `keccak256(proof.storageKey) == keccak256(expected)`; version the layout in the same domain separator used in `TitleLib.DOMAIN`.

### M-02 — `ThresholdRootFeed` cannot revoke a vote, expire a proposal, or rotate an attester

`contracts/ThresholdRootFeed.sol:24-32`, `:69-88`

`approved[proposal][attester]` is monotonic (`:77-79`), approvals never expire, `attesters` is fixed at construction (`:56-64`), and there is no `removeAttester`. Consequences:

- An attester who approved a root by mistake cannot withdraw it; if threshold-1 such approvals exist, the next signer finalizes an unrecoverable bad root.
- A compromised or lost attester key cannot be removed — recovery requires redeploying the feed and every gate that points at it (the gate holds `feed` as `immutable`, `contracts/TitleGateBase.sol:40`).
- Nothing enforces that the three attesters are independent entities; the "2-of-3" property is a deployment promise with no on-chain evidence.
- Proposals at arbitrarily distant future block numbers can be pre-approved, each consuming storage; a quorum that finalizes a bogus far-future height makes every honest proof at a lower height unusable (`:72-74`), halting the feed.

**Fix** — add `revoke(root, blockNumber)` that decrements and clears the flag before finalization, a proposal `expiry` (block-number bound), `scheduleAttesterChange`/`executeAttesterChange` with a timelock and an `AttesterRemoved` event, and a `maxFutureBlocks` bound in `attest`. Keep the immutable-set property but make rotation an explicit, delayed, event-emitting path.

### M-03 — Unilateral commitment changes and a pause that also blocks exits

`contracts/TitleGateBase.sol:116-127`

`setTitleCommitment(next)` accepts any non-zero `bytes32` with no timelock, no two-step confirmation and no event consumers to veto. A compromised owner can point the gate at a commitment for a *different real record* of the same title (the check is only "a proven record hashes to this"), which changes what the token represents without holder consent — e.g. a record whose `backing` is a dust amount while supply is unchanged.

`setPaused(true)` blocks `_gate` (`:136`) and therefore transfers **and** burns, so holders cannot exit or redeem during a pause. The ERC-721 `safeTransferFrom` receiver hook also cannot run.

**Fix** — two-step `proposeTitleCommitment`/`acceptTitleCommitment` with a delay (24-72 h) and a `CommitmentChangeScheduled` event; make `paused` block new mints and transfers *into* the system but never burns, and document the owner as a trusted role in the trust table.

### M-04 — Unauthenticated, unlimited proof verification endpoint

`server/src/app.ts:42`, `:51`, `:159-171`; `server/src/schemas.ts:9-12`, `:125`

`/v1/verify/native` accepts up to 512 caller-supplied nodes, each matched by `hexSchema` with **no length cap** (only the global 2 MB body limit bounds it), and performs hashing, decoding and re-verification per request. There is no rate limit, no auth, no per-IP quota, and `access-control-allow-origin: *` means any page can drive it from a victim's browser. The same endpoint fans out to the upstream RPC (21 s timeout, `server/src/config.ts:48`).

Impact: trivial CPU/memory amplification (many 4-byte nodes each hashed; several MB of hex per request body) and upstream RPC quota burn from any origin. Not a key-compromise vector, but it is the service that mints the proofs the console displays.

**Fix** — cap node count *and* per-node length in the schema (a trie node is ≤ ~1 KiB in practice), cap total decoded bytes, add Fastify rate limiting keyed by IP (and by a token for the console), and replace `*` with an explicit origin allowlist.

### M-05 — RPC URLs are published and logged

`server/src/schemas.ts:150`, `:168` (`substrate.url`, `evm.url` in `/v1/network`); `script/Deploy.s.sol:59` (`console2.log("rpc", ...)`)

Provider URLs very often carry an API key in the path or query (`https://rpc.example/v2/<key>`). `/v1/network` returns them verbatim with `access-control-allow-origin: *`, and the deploy script writes the same string into `broadcast/` artifacts and terminal/CI logs. `docs/DEPLOYMENT.md` instructs keeping secrets in `.env.local`, but this path exports them.

**Fix** — return a redacted URL (`new URL(u).origin` plus a `hasApiKey: true` flag), and never log the raw URL in the deploy script; log the chain id and genesis hash instead.

### M-06 — Underpriced, deposit-free, overflowable title namespace

`pallets/lemo-title/src/lib.rs:93-123`

Every call carries `#[pallet::weight(Weight::from_parts(10_000, 0))]` (`:93`, `:126`, `:140`, `:167`, `:182`, `:196`), identical for a no-op `set_identity` and a 260-byte insert; `Titles` is `#[pallet::unbounded]` (`:45-47`) and there is no `ReserveDeposit`. `create_title` accepts any caller-chosen `title_id` with no bond and no signature from the eventual owner.

Consequences: (a) state bloat at near-zero cost — an attacker registers a large number of titles; (b) title-id squatting/front-running — an attacker observes a pending `create_title(title_id = X)` and registers `X` first with `backing` of their choosing (`:99` accepts any hash, nothing verifies it corresponds to locked funds), permanently owning the id and making the victim's call fail `TitleExists` (`:105`); (c) a title can claim arbitrary "backing" that no pallet check ties to real collateral, which is the assumption every "backed" claim downstream inherits.

**Fix** — benchmarked weights per call with a proof-size component, `ReserveDeposit` (or `holds`) on `create_title`, require a commitment/signature tying `title_id` to the creating account (e.g. `title_id = hash(creator, salt)` or a signed intent), and make `backing` a pallet-enforced lock (reserve the asset) rather than a caller-supplied hash.

### M-07 — One-step native unbond deletes the record, stranding live representations

`pallets/lemo-title/src/lib.rs:183-193`

`request_unbond` immediately `Titles::remove(title_id)` and `RepresentationLive::remove(title_id)` (`:189-190`) with no unbonding period, no cancellation, and no tombstone. Once the record is gone, no state proof for that title can ever exist again. Combined with H-05 (default-false flag) this both (a) releases backing while supply may exist, and (b) makes any surviving representation permanently unbacked and unprovable — the EVM gate's `_gate` will never pass again, so the token is frozen with `representationOutstanding() == true`.

**Fix** — a three-phase pallet flow: `RequestUnbond` (sets `Unbonding { at: now + period }`, does not delete), `CancelUnbond` (owner, before expiry), `FinalizeUnbond` (permissionless after expiry, deletes and emits). Require `RepresentationLive == Some(false)` at *finalize* as well. Mirror the same ordering in `UnbondGuard` (H-03).

### M-08 — ERC-721 is not ERC-165 compliant

`contracts/TitleGateERC721.sol` (no `supportsInterface` anywhere in the file; `IERC721Receiver` is declared locally at `:8-12`)

Marketplaces, wallets and `ERC721Holder`-style checks call `supportsInterface(0x80ac58cd)`; this contract reverts (no fallback), so integrators treat it as "not an NFT". Not a loss-of-funds bug, but it breaks the standard the contract claims and will break custodial/wrapped integrations.

**Fix** — inherit ERC-165, return true for `0x01ffc9a7` and `0x80ac58cd`, and add `tokenURI`/`Approval` semantics review if marketplaces are in scope.

### M-09 — Wallet layer trusts unauthenticated announcements and unvalidated addresses

`lib/wallet/eip6963.ts:83-106`; `lib/wallet/substrate.ts:81-102`

`parseAnnouncement` accepts any injected object's `name`, `rdns`, `uuid` and `icon`, and `rdns` is used as the identity (`:94`). Any script on the page (a compromised dependency, an XSS elsewhere) can announce a provider labelled "MetaMask" and the menu will render it as such. Nothing in the UI distinguishes a spoofed `rdns` from a real one. On the Substrate side, `normalizeAccounts` accepts any non-empty string as an address — no SS58 checksum, no prefix (42) check, no length check — and the console displays it (`components/wallet/wallet-menu.tsx:220-223`).

**Fix** — pin a known-`rdns` allowlist for "verified" badges and show all others as unverified, validate icons against a `data:image/(png|svg+xml|webp)` allowlist, and validate SS58 with `decodeAddress(addr, false, 42)` (try/catch) before display or storage. Note the wallet layer is read-only today (`lib/wallet/substrate.ts:8-9`, `lib/wallet/eip6963.ts:8-10`), so this is a display-integity issue, not a signing issue.

---

## Low

**L-01** `contracts/TitleGateBase.sol:117` — `if (next == bytes32(0)) revert ZeroAddress();` in `setTitleCommitment` should be `ZeroCommitment()` (declared at `:88`, never used). Misleading selector for integrators and monitoring.

**L-02** `contracts/UnbondGuard.sol:28-29` — `OP_UNBOND = 4` is only used in nullifier/id derivation while the proof is checked against `REQUIRED_PROOF_OPERATION = 3`; the two constants describe one operation and will drift. `requestBlock[id]` (`:108`) is written and never read (no expiry), and there is no `cancelUnbond`. Collapse to one named constant, delete or use `requestBlock` for an expiry check.

**L-03** `contracts/ReviveBlake2b256.sol:31`, `:37-42` — `STATIC_CALL_GAS` is declared and unused; `staticcall` forwards all remaining gas. A malicious/broken precompile could consume the whole call budget. Bound it: `assembly { ok := staticcall(gasLimit, addr, in, size, out, 32) }`. Also note the precompile address and selector (`:29-30`) are chain-specific; a deployment on another Revive chain fails closed at runtime with no startup check. Add a constructor-time `hash("")` smoke test that reverts on the wrong chain.

**L-04** `contracts/LemoTitle.sol:133-173` — `writer` is a single EOA with a one-step `setWriter` (no accept step, no event on the previous writer's side beyond the emit), `TitleIdIsImmutable` (`:144`) is declared but never used, and `commit` may set `owner` to `address(0)` or any address without a signature from it. This contract is documented as a reference implementation (`:130-132`), so severity is low, but it is the executable definition of the revision rule: add `proposeWriter`/`acceptWriter`, drop or use the dead error, and reject `record.owner == address(0)`.

**L-05** `contracts/SubstrateTrieVerifier.sol:344-347` — the hashed-value lookup marks `reached[index] = true` without the "already reached" cycle check that `_descend` performs at `:309-312`. It cannot currently be exploited (a hash cycle would need a blake2b fixed point, and the value still must be committed), but the asymmetry is an easy place for a future refactor to introduce a loop. Also `_indexOf` (`:559-564`) returns the first node with a matching hash, so duplicate identical nodes in the set are silently interchangeable; reject duplicates at `:215-220` for a clean INVALID.

**L-06** `script/Deploy.s.sol:59`, `:72-82`, `:94-102` — `THRESHOLD=1` is accepted (see H-07), the raw `RPC_URL` is printed (M-05), and the gate owner is the deployer EOA with `owner` immutable and no transfer path (`contracts/TitleGateBase.sol:43`). Use a multisig/timelock as `OWNER` and enforce `threshold >= 2` when three attesters are supplied.

**L-07** `contracts/TitleGateERC20.sol:56` vs `:64-83` — `transfer` rejects `to == msg.sender` explicitly, but `transferFrom` allows `from == to`, consuming the nullifier and decrementing the allowance for a no-op that moves nothing. Add `if (from == to) revert SameOwnerAndRecipient();` in `_transfer` instead of only in the public entry point.

**L-08** `components/wallet/wallet-menu.tsx:47-58` — wallet-announced `icon` is used as an `<img src>` with no scheme allowlist (a remote URL becomes a tracking beacon on every menu open). `next.config.ts` sets no headers at all: no CSP, no `X-Frame-Options`, no `Referrer-Policy`. Add a static-export-compatible `headers()` (or document the hosting configuration) with `default-src 'self'`, `img-src 'self' data:`, `frame-ancestors 'none'`.

**L-09** `contracts/SubstrateTrieVerifier.sol:59-61` vs `:226-247` — the docstring says a supplied node that no reference reaches is `INVALID`, and `w.reached[]` is allocated and populated (`:226-227`, `:313`, `:346`), but the array is never inspected after the walk. An extra, entirely unused node in the proof set is therefore accepted with `PROVEN` instead of `INVALID`. It is not exploitable today (every consumed value is still root-committed), but the code does not enforce the property it documents, so a future refactor that starts trusting "the set contains exactly what the root references" would be unsafe. Fix: after the loop, `for (i = 0; i < w.reached.length; i++) if (!w.reached[i]) return (Status.INVALID, "");` — and add the negative test (`test/SubstrateTrieVerifier.t.sol` has no substituted-unreachable-node case).

---

## Invariant review

| Claimed invariant (source) | Holds? | Notes |
| --- | --- | --- |
| No EVM state change without a proof at the feed's current root (`TitleGateBase.sol:10-11`) | Yes | Root equality is checked first (`:138-140`); empty feed fails closed |
| Same proof cannot authorise a second state change (`:28-29`) | **No** | H-01: root is in the nullifier and revision may repeat |
| Revision never moves backwards (`:22-23`) | Partly | `<` allows equal; monotonic but not spend-limiting |
| Title id and chain id immutable (`LemoTitle.sol:126-128`) | Yes | `chainId` and `titleId` are fixed per record; EVM side pins `boundChainId` and `titleId` |
| Revision only ever moves by one (`LemoTitle.sol:127-128`) | Yes | `commit` enforces `previous + 1` and start-at-1 |
| Native unbond refused while representation outstanding (`UnbondGuard.sol:9-11`) | **No** | H-03 (release-time), H-05 (flag default), M-07 (one-step delete) |
| A missing node is never "absent" (`SubstrateTrieVerifier.sol:51-66`) | Yes | `_verify:236-245` maps unreachable reference to INCOMPLETE; ABSENT only from divergence/leaf end |
| Every proof node must be reachable (`:59-61`) | **No** | `reached[]` is tracked but never checked at the end of the walk — unreachable extra nodes are accepted silently, contradicting the docstring and the `INVALID` status description |
| Value is committed by the root (`:14-18`) | Yes | Value is sliced from a root-committed node, hashed by blake2b-256 precompile, all reads bounds-checked (`_decode:355-455`) |

The `reached[]` gap (L-09) is worth fixing even though it is not exploitable today: add a final loop over `w.reached` and return `INVALID` if any entry is false. It makes the docstring true and keeps substitution attempts detectable rather than merely harmless.

## Test coverage gaps behind these findings

The 83 passing tests are strong on malformed trie input and on single-root negative cases. They do not cover:

1. Re-running an operation after the feed advances the root at an unchanged revision (H-01, C-01, C-02). `test/TitleGate.t.sol:238-260` replays at the *same* root only.
2. Mint/burn recipient and amount binding (C-01, C-02, H-02) — no test mints to a third party or burns a non-caller's balance.
3. Unbond release with supply re-minted after the request (H-03), and two pending requests (H-04) — `UnbondGuard` has no test file at all.
4. Pallet encoding → Solidity decode round-trip (H-06); `test/LemoTitle.t.sol:136-153` round-trips the Solidity encoder with itself.
5. Zero-address mint on ERC-721 (H-08).
6. `RootFeed` monotonicity and attester rotation (H-07) — `RootFeed` behaviour is asserted only through the gate tests.

## Recommended fix order

1. C-01, C-02, H-01 together (one change: revision-scoped nullifier + supply/amount/recipient binding).
2. H-03, H-04, H-05, M-07 as one Rule-2 unit — until then, do not deploy a representation against a title with real backing.
3. H-02, H-08 (small, independent).
4. H-06 before any pallet runtime upgrade; add the fixed-width runtime API and shared vectors first.
5. H-07, M-02, L-06 as deployment-hardening; M-04/M-05 before exposing the proof service publicly.

## Notes

- `.env.local` is ignored (`*.local` in `.gitignore`) and absent from all git history (`git log --all -- .env.local` is empty); `.env.deploy.example` and `.env.local.example` contain no values.
- No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` anywhere in `app/`, `components/`, `lib/` — the console renders server data through React text nodes only.
- `git status` shows one untracked directory, `lib/flow/`, which was not reviewed; confirm it is intentional and not a stray checkout before committing.
- This audit does not cover `pallet-revive`'s precompile implementation, the native chain's finality, or `sp-trie` itself. The trie verifier's correctness is bounded by the blake2b-256 precompile being blake2b-256; the selector is asserted in `test/Blake2b256.t.sol` and was checked against the live V3 endpoint (see `contracts/ReviveBlake2b256.sol:9-27`).
