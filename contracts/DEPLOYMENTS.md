# Deployed on Portaldot V3 Test

Two contracts, both live. Values were read back from the chain.

| | |
|---|---|
| Network | Portaldot V3 Test (`PortaldotV3 Test`, spec 3002) |
| Substrate RPC | `wss://test-node-v3.portaldot.dev` |
| EVM RPC | `https://test-evm-rpc-v3.portaldot.dev` |
| EVM chain id | 420420777 |
| Deployer | `0x09110714Ea97feaBCf0CAe2dcb1Be6Da69ABcDfA` |

| Contract | Address | Code | Source |
|---|---|---|---|
| Title registry | `0xc88763FA361669fC5d95c2BDD924b0E2872488bB` | 1,255 B | `src/LemoTitle.sol` |
| ERC-20 representation | `0x61c35d5e811b99f2641b43e9ef97e50d52de8ff7` | 2,520 B | `src/LemoERC20Lite.sol` |

Explorer: `https://node-console.portaldot.dev/` — the chain's own console; generic polkadot.js hosts
cache metadata per origin and hang on this chain.

## Transactions

| Action | Transaction | Block |
|---|---|---|
| deploy `LemoTitle` | `0xb65d70260e5f7c53540a7ba7f9cb6488760f99f638096a557e7e8f554e6987eb` | 292497 |
| settle title from a verified package | `0x8bf6072c6a9fc191da973d5e5650dc86c006b042e6461293cd3961d4c9a8d38f` | 292501 |
| raise revision to 292498 | `0xebd226c25ae0f183608a1197d8cfe5897384a6b5e69b04c8a97b5bec4d0e66e9` | 292503 |
| deploy `LemoERC20Lite` | `0x92c78598d9183f52c0ee81123112c534255d69597e49e8e51856d42e5b48d7c3` | 292632 |
| mint 1,000 (to cap) | `0xe7391b28393c1273b0d9e5316725408c57e189b2ee34447fe77c8cb1ace8b525` | 292633 |
| transfer 10 while eligible | `0x82cf8b4ea676eb30b29e31ab9019c571fd650c2d27e2c10e88cba7bf9478c11f` | 292634 |
| freeze the title | `0xc038a6d31cd1076a0dfe60b0267b28b4bc85458af15ee8582a3cf2bb4a599a2f` | 292639 |
| transfer while frozen | **reverts** (`Ineligible`) — not mined | — |
| unfreeze the title | `0xd8958bbf3de0dfc42cab20b8d1a013da4cd1a44c550b107e58f7e791c9e4f068` | 292640 |
| transfer 5 after unfreeze | `0xfab5374ab496e3211379d0cce42475b681748f105652c03fe7d8268aad7f95b8` | 292641 |

## What the contracts hold

Title `0xeeee…ee` in the registry (`titles(bytes32)`):

```text
asset     0xabab…ab
backing   1000
revision  292498          (the finalized block the proof package was built at)
digest    0x80c4314e47dcfa99ba3573aba12ea30b1899288d32ce83d97567b93a3dfc0336
eligible  true
```

`LemoERC20Lite` reads back as `decimals 18`, `cap 1000`, `totalSupply 1000`. Its `transfer` calls
`registry.eligible(titleId)` before moving a balance, so Rule 1 is enforced by the token rather than by
a server; the frozen-transfer revert above is that code path.

The digest is recorded, not proven, by the contract. Re-run `GET /titles/:id/proof` for the same
title and compare the digest to check the record.

## Why two contracts and not four

`LemoTitleRegistry.sol` (2,457 B) and `LemoERC20.sol` (3,489 B) were the first drafts of the same two
contracts. They are superseded by the versions above, which do the same work in 1,304 and 3,313 bytes
of creation code. Deploying them would have cost roughly another 350 POT and 470 POT for duplicate
behaviour, so they were removed from `src/` instead of shipped as dead code.

## Cost, measured

Portaldot charges a storage deposit per code byte (`Revive.depositPerByte = 6e12` plancks =
0.06 POT/byte) on top of the weight fee, and the EVM mempool prices weight as gas. Measured here:

| Contract | Creation code | Fee paid | Deposit held |
|---|---|---|---|
| `LemoTitle` | 1,304 B | ≈111 POT | ≈78 POT |
| `LemoERC20Lite` | 3,313 B | ≈218 POT | ≈199 POT |

Two properties of this chain worth keeping: revive gas is weight-scaled (a plain transfer estimates
~5.1e11, so a transaction below the node's estimate is rejected outright), and the runtime rejects
Cancun opcodes — the contracts are compiled with `evmVersion: "shanghai"`.

## Reproduce

```bash
cd contracts
npm install
node scripts/compile.mjs
LEMO_EVM_SEED="<mnemonic>" node scripts/quote.mjs          # fee + deposit, no submission
LEMO_EVM_SEED="<mnemonic>" node scripts/deploy-evm.mjs     # registry
LEMO_EVM_SEED="<mnemonic>" node scripts/deploy-token.mjs   # representation token
LEMO_EVM_SEED="<mnemonic>" node scripts/settle.mjs         # write a verified package digest
LEMO_EVM_SEED="<mnemonic>" node scripts/gate-check.mjs     # freeze → refused, unfreeze → moves
```

The seed is read from the environment for that one process; it is never written to the repo.
