# Deployed on Portaldot V3 Test

Every value below was read back from the chain, not copied from a log.

| | |
|---|---|
| Network | Portaldot V3 Test (`PortaldotV3 Test`, spec 3002) |
| Substrate RPC | `wss://test-node-v3.portaldot.dev` |
| EVM RPC | `https://test-evm-rpc-v3.portaldot.dev` |
| EVM chain id | 420420777 |
| Contract | `0xc88763FA361669fC5d95c2BDD924b0E2872488bB` |
| Contract size | 1,255 bytes of deployed code (`eth_getCode`) |
| Deployer | `0x09110714Ea97feaBCf0CAe2dcb1Be6Da69ABcDfA` |
| Source | `src/LemoTitle.sol` |

## Transactions

| Action | Transaction | Block |
|---|---|---|
| deploy `LemoTitle` | `0xb65d70260e5f7c53540a7ba7f9cb6488760f99f638096a557e7e8f554e6987eb` | 292497 |
| settle title from a verified package | `0x8bf6072c6a9fc191da973d5e5650dc86c006b042e6461293cd3961d4c9a8d38f` | 292501 |
| freeze the title (eligibility false) | `0x2f6ec1cfed2e140a16b320e5b7f8349db6db5c3bbe0c3477357fc65db00aeae6` | 292502 |
| raise the revision | `0xebd226c25ae0f183608a1197d8cfe5897384a6b5e69b04c8a97b5bec4d0e66e9` | 292503 |
| rejected: older revision | reverts with `stale` (not mined) | — |

Explorer: `https://node-console.portaldot.dev/` (the chain's own console; a generic
polkadot.js host caches metadata per origin and hangs on this chain).

## What the contract holds

The settled record for title `0xeeee…ee`, read back with `titles(bytes32)`:

```text
asset     0xabab…ab
backing   1000
revision  292497          (the finalized block the proof package was built at)
digest    0x80c4314e47dcfa99ba3573aba12ea30b1899288d32ce83d97567b93a3dfc0336
eligible  true
```

The digest is the package digest the LEMO service produced and verified against that block's state
root. The contract records it; it does not by itself prove it. Re-run `GET /titles/:id/proof` for the
same title and compare the digest to check the record.

## Cost, measured

Portaldot charges a **storage deposit per code byte** (`Revive.depositPerByte = 6e12` plancks =
0.06 POT/byte) plus a weight fee. The EVM mempool path prices weight as gas, so the deploy cost is
dominated by code size:

| Item | Value |
|---|---|
| gas estimate (1,304-byte creation code) | 4,690,529,375,494,107 |
| gas used on chain | 4,618,334,141,149,490 |
| base fee | 24,065 wei |
| fee paid | ≈ 111 POT |
| code deposit held | ≈ 78 POT (refundable on code removal) |

A 2,457-byte contract quotes ≈ 200 POT fee + 147 POT deposit, and a 3,489-byte one ≈ 209 POT
deposit alone — which is why the deployed contract is the compact one.

## Reproduce

```bash
cd contracts
npm install
node scripts/compile.mjs
LEMO_EVM_SEED="<mnemonic>" node scripts/quote.mjs          # fee + deposit, no submission
LEMO_EVM_SEED="<mnemonic>" LEMO_ARTIFACT=../artifacts/LemoTitle.json node scripts/deploy-evm.mjs
LEMO_EVM_SEED="<mnemonic>" LEMO_CONTRACT=0xc887… node scripts/settle.mjs
```

The seed is read from the environment for that one process; it is never written to the repo.
