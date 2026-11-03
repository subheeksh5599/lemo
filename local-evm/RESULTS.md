# LEMO local EVM proof test

**Label: LOCAL / FOUNDRY EVM ONLY.** Nothing here contacts Portaldot, signs a
Portaldot transaction, spends tPOT, or touches the production gate.

The capture is `../fixtures/lemo-local-capture.json`. It is a real title from
the local Substrate runtime, with a 320-byte canonical record and an 80-byte
Substrate storage key. The fixture's `record.evmContract` is bound to the gate
address used by the test, so the proof can authorize an EVM operation instead
of only proving bytes.

## Reproduce

```bash
cd /Users/subheeksh/code/lemo/local-evm
export PATH=$HOME/.foundry/bin:$PATH
forge test -vv
```

The test suite runs on Foundry's local EVM at chain id `420420777`, compiled
from the repository's own `contracts/`. It does not need Anvil, a node, or a
network.

## Result

`forge test` — **6 passed, 0 failed**:

| test | result |
|---|---|
| canonical value is 320 bytes and decodes | pass |
| 319/321 byte blobs are rejected | pass |
| fixture trie verifies with the full 80-byte key | pass |
| `verifyTitle` accepts the fixture proof | pass |
| gate mints 100 and transfers 40 from the fixture | pass |
| derived binding drill still works | pass |

The fixture path mints and transfers through `TitleGateERC20` with the fixture's
own proof, key and root. No derived record is used for that test.

Fixture values from the committed capture:

- finalized block `23`
- state root `0x612a782d77e95425f8129f9db7aa97fd5d57228a58ab2530c46fbba71f06bd0e`
- canonical value 320 bytes
- canonical storage key 80 bytes
- title id `0xee00…0000`
- revision `3`
- bound EVM contract `0xa0Cb889707d426A7A386870A03bc70d1b0697598`

## Why the interface changed

The first run exposed a real interface defect: `ITitleVerifier.TitleProof`
carried `storageKey` as `bytes32`, while a Substrate key is 80 bytes. The
verifier truncated it and the gate returned `ABSENT`. The proof struct now uses
`bytes storageKey`; `SubstrateTrieVerifier` passes it through, and the fixture
verifies with its full key. The ABI and selectors in `lib/flow/abi.ts` were
updated with the new tuple.

## What this proves

- the 320-byte canonical record decodes through `TitleLib.decodeNative` and
  re-encodes byte for byte;
- the committed 80-byte storage key and four proof nodes verify through
  `SubstrateTrieVerifier` at the committed state root;
- `verifyTitle` returns `PROVEN` for the fixture, with the record bound to the
  gate;
- the deployed `TitleGateERC20` accepts a mint and transfer from the fixture and
  advances the accepted revision.

## What this does not prove

- that the local root came from Portaldot. `RootFeed` is a single local
  attester; it trusts the root the test hands it.
- anything about the public Portaldot runtime, tPOT, or the paused production
  gate.
- a native unbond or the full Rule 2 lifecycle; the local template has no
  Revive/EVM layer, so this is a Foundry EVM test over the native capture.
- an external audit, multi-node finality, or persisted local chain state.

## Files

```text
local-evm/
  foundry.toml
  test/FixtureTitle.t.sol     fixture + gate proof tests
  src/FixtureHarness.sol      local fixture calldata helper
  script/Deploy.s.sol         optional Anvil deployment
  RESULTS.md                  this file
```

The canonical local-EVM result is `forge test`; it is the fixture evidence.
