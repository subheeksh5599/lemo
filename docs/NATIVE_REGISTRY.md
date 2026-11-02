# Native title registry

`pallets/lemo-title` is the native half of the protocol: the storage the EVM gates
prove against, the revision rule, and the unbond guard.

It is a FRAME pallet, not a contract. It compiles into the runtime's WASM. It is
not live: Portaldot V3 does not expose the contracts runtime module, and adding a
pallet is a runtime upgrade, not a website change.

## Record

`TitleRecord` is the ten field shape the Solidity commitment hashes:

| Field | Type | Meaning |
| --- | --- | --- |
| `title_id` | `T::Hash` | the title identity, immutable |
| `chain_id` | `u64` | the chain the record belongs to |
| `native_asset` | `T::Hash` | the native asset or asset class |
| `backing` | `T::Hash` | the locked backing reference |
| `owner` | `T::AccountId` | the native owner |
| `identity_hash` | `T::Hash` | cleared identity is the zero hash |
| `vesting_hash` | `T::Hash` | vesting conditions |
| `permissions_hash` | `T::Hash` | permission conditions |
| `evm_contract` | `[u8; 20]` | the representation address, zero when unbound |
| `revision` | `u64` | monotonic; every owner edit increments it |

The FRAME encoding is not the EVM commitment: the EVM side decodes the fixed
width 320 byte record defined in `contracts/LemoTitle.sol`. The pallet stores the
same fields so a runtime API can expose that fixed width record without a second
source of truth.

## Calls

| Call | Origin | Effect |
| --- | --- | --- |
| `create_title` | signed | inserts revision 1; rejects a duplicate id |
| `set_identity` | owner | updates the identity hash; bumps revision |
| `set_representation` | owner | sets the EVM contract; bumps revision |
| `set_representation_live` | `AdminOrigin` | mirrors whether the EVM representation has supply |
| `request_unbond` | owner | refuses while the representation is live; removes the record otherwise |
| `transfer_owner` | owner | changes the owner; bumps revision |

`set_representation_live` exists because the native runtime cannot read EVM
storage. The bridge or runtime API that observes the representation writes this
flag. That is a trust boundary and it is named as one.

## Tests

```bash
cd pallets/lemo-title
cargo test
```

The suite covers creation, duplicate refusal, owner-only edits, revision
increments, representation binding, and the unbond guard.

## Runtime integration

1. Add `pallet-lemo-title` to the runtime's `Cargo.toml`.
2. Add `LemoTitle: pallet_lemo_title` to `construct_runtime!`.
3. Implement `pallet_lemo_title::Config` with `AdminOrigin`.
4. Expose a runtime API that returns the fixed width record for a `title_id`.
5. Wire the EVM-to-native liveness signal into `set_representation_live`.
6. Upgrade the runtime and publish the chain spec.

Steps 1 to 5 are code. Step 6 is a chain operation and is not in this repository.
