# Deployment cost on Portaldot V3

> **Funding note (later than the measurements below):** the EVM address
> `0x884fe7b4Df96D257c23c2DB2077a511C4db2aBf7` is not the wallet that pays for
> deployment. The native account `5GEXs8zz7giva7C2FcoLmTM4TgH6HgzSPZF7Qzj8n742tiVx`
> holds the tPOT and pays via `revive.instantiateWithCode`. See
> [DEPLOYMENT.md](DEPLOYMENT.md). The table below is still valid for the EVM
> gas-model estimate, but the “20.877 tPOT balance” is the EVM-side balance, not
> the native budget.

Measured, not estimated from a rule of thumb. This file records what the live
V3 node charges to create each contract in `contracts/`, and what the funded
address can actually afford.

- Date of measurement: 2026-11-02
- RPC: `https://test-evm-rpc-v3.portaldot.dev`, chain id `420420777`
- Deployer (from): `0x884fe7b4Df96D257c23c2DB2077a511C4db2aBf7`
- Balance: `20,877,284,237,534,510,315` wei = **20.877284237534510315 tPOT**
  (`eth_getBalance`, block 294,082). Re-read at block 294,089 it was
  `20,864,976,415,073,204,345` — see the drift note at the bottom; the verdict
  does not depend on it.
- Gas price: **23,970 wei** (`eth_gasPrice` = `eth_baseFeePerGas` = `0x5da2`,
  `eth_maxPriorityFeePerGas` = `0x0`). Flat across the last five blocks, so the
  figure below is not a momentary quote.
- Nonce at measurement: `2` (`eth_getTransactionCount`)
- Build: `forge build --sizes` (solc 0.8.26, optimizer 200 runs, `evm_version =
  "shanghai"`, `bytecode_hash = none`, per `foundry.toml`)

Nothing was deployed, signed, or sent. Every number below comes from read-only
calls: `eth_estimateGas` with a `from` address and the creation bytecode as
`data`. No private key was read, no transaction was signed, and `.env.local` was
not opened.

## How each number was produced

1. `forge build --sizes` for the deployed bytecode sizes.
2. For each contract, `out/<File>.sol/<Name>.json` → `bytecode.object`,
   concatenated with the ABI-encoded constructor arguments the deploy script
   would pass (real address placeholders, `"LEMO Title 1"` / `"LT1"` for the
   gate name and symbol, a 3-address / threshold-2 array for the threshold feed).
3. `eth_estimateGas({from, data})` against the V3 EVM RPC.
4. `cost = gas × 23,970 wei`. The EVM side is 18-decimal wei: 1 native base
   unit (1e-14 tPOT) × Ratio 10,000 = 1 wei, so 1 tPOT = 1e18 wei and the
   `eth_getBalance` figure prints directly as the tPOT balance.

The node does not cap the estimate at the caller's balance — every estimate
below succeeded even though most of them cost more than the balance. That is
expected for a fee-model node, and it is why the estimate alone cannot tell you
whether you can afford it. The comparison to the balance is done here.

## Per-contract cost

| Contract | Runtime B | Init bytes | eth_estimateGas | Cost (wei) | Cost (tPOT) |
| --- | --- | --- | --- | --- | --- |
| ReviveBlake2b256 | 751 | 779 | 3,041,218,981,766,734 | 72,898,018,992,948,613,980 | **72.898019** |
| SubstrateTrieVerifier | 8,350 | 8,521 | 28,188,187,242,153,667 | 675,670,848,194,423,397,990 | **675.670848** |
| RootFeed | 1,515 | 1,801 | 5,896,171,858,768,552 | 141,331,239,454,682,191,440 | **141.331239** |
| ThresholdRootFeed | 1,181 | 1,921 | 5,607,352,364,656,606 | 134,408,236,180,818,845,820 | **134.408236** |
| TitleGateERC20 | 5,465 | 6,545 | 19,134,799,310,586,535 | 458,661,139,474,759,243,950 | **458.661139** |
| TitleGateERC721 | 7,484 | 8,564 | 25,815,972,077,121,324 | 618,808,850,688,598,136,280 | **618.808851** |
| UnbondGuard | 3,466 | 3,964 | 12,028,229,132,329,500 | 288,316,652,301,938,115,000 | **288.316652** |
| LemoTitle | 3,019 | 3,109 | 10,709,399,630,928,372 | 256,704,309,153,353,076,840 | **256.704309** |

`TitleGateERC721`, `UnbondGuard` and `LemoTitle` are compiled but **not
deployed** by `script/Deploy.s.sol`; they are measured because they are built.
Test-only contracts in `test/` (mocks, harnesses) are excluded.

## What the deploy script actually costs

`script/Deploy.s.sol` creates four contracts. Which feed it creates depends on
`THRESHOLD`:

| Deployment | Contracts | Gas | Cost (tPOT) | Balance covers |
| --- | --- | --- | --- | --- |
| `Deploy.s.sol` with `THRESHOLD=2` (what `.env.deploy.example` sets) | ReviveBlake2b256 + SubstrateTrieVerifier + ThresholdRootFeed + TitleGateERC20 | 55,971,557,899,163,542 | **1,341.638243** | 1.56% |
| `Deploy.s.sol` with `THRESHOLD=0` (single feed) | ReviveBlake2b256 + SubstrateTrieVerifier + RootFeed + TitleGateERC20 | 56,260,377,393,275,488 | **1,348.561246** | 1.55% |
| Every deployable contract in `contracts/` | all eight above | 110,421,330,598,311,290 | **2,646.799294** | 0.79% |

## Verdict against the 20.877 tPOT balance

**Not enough. Not for the full deployment, and not even for the smallest single
contract.**

| Target | Cost (tPOT) | Balance (tPOT) | Shortfall (tPOT) |
| --- | --- | --- | --- |
| Cheapest single contract (ReviveBlake2b256) | 72.898019 | 20.877284 | **52.020735** |
| `Deploy.s.sol`, `THRESHOLD=2` | 1,341.638243 | 20.877284 | **1,320.760959** |
| `Deploy.s.sol`, `THRESHOLD=0` | 1,348.561246 | 20.877284 | **1,327.683962** |
| All eight contracts | 2,646.799294 | 20.877284 | **2,625.922010** |

The balance covers 28.6% of the *cheapest individual* contract and 1.6% of the
sequence the deploy script runs. A broadcast against this balance fails the
upfront fee check on the first `new ReviveBlake2b256()`, before any contract is
created — Revive charges at validation, so it should not spend anything. There
is no reason to confirm that against the live chain.

## Where the money goes

Revive prices a creation as a base charge plus a per-byte code deposit. Fitting
the eight measurements (R² = 0.99) gives:

```
gas ≈ 273,765,138,068,514 + 3,074,400,905,970 × init_bytes
```

At 23,970 wei/gas that is **~6.56 tPOT fixed + ~0.0737 tPOT per byte of
initcode**. The fixed part alone — before a single byte of bytecode — is about a
third of the whole balance. `SubstrateTrieVerifier` is 50.4% of the script's cost
because it is 8.5 KB; `TitleGateERC20` is another 34.2%.

That matches the independent figure in `docs/DEPLOYMENT.md` (an 899 byte
deployment, 83.232 tPOT of storage deposit plus a small fee). The model there is
right; this file only makes it per-contract and exact.

Consequence: roughly **194 bytes** of initcode is the most this balance can
deploy. The smallest contract in the repository is 779 bytes.

There is no cheaper price to shop for. `eth_maxPriorityFeePerGas` is `0x0` and
the base fee is the only component; a legacy transaction below `0x5da2` is
rejected. Deployment cost is therefore fixed at the code size, and the only
lever left is funding.

## Recommendation

**The smallest real deployment that fits in 20.877 tPOT does not exist.** Any
answer that says "deploy X first" for this balance is wrong, because X does not
exist in this repo — the smallest artifact is 72.9 tPOT. Do not attempt a
partial broadcast; nothing will land and the account stays where it is.

The smallest deployment that is worth doing, in increasing order:

1. **Smoke test, 72.898 tPOT.** `ReviveBlake2b256` alone. It buys one honest
   `CREATE` on V3 and proves the chain accepts this build (Shanghai EVM target,
   no Cancun opcodes) and that the mapped native account is actually funded.
   Requires a top-up of **≥ 52.021 tPOT**. It is a probe, not the product.
2. **The real thing, 1,341.638 tPOT.** `Deploy.s.sol` with `THRESHOLD=2`, which
   is what `.env.deploy.example` sets and what the README describes. Requires a
   top-up of **≥ 1,320.761 tPOT**. This is the number to request from the
   Portaldot Discord once per 24 h — ask for **1,400 tPOT** so a little price or
   argument-length drift does not turn a funded run into a partially deployed
   one (the `name`/`symbol` strings are part of the bytecode payload; longer
   ones cost slightly more).
3. **Skip `TitleGateERC721` and `UnbondGuard` on-chain** until there is a second
   title to gate. They add 907 tPOT and nothing in the current flow reads them.

If testnet tPOT cannot be raised to 1,400, the honest alternative is a local
`anvil` run for functional testing and no V3 deployment at all. Spending 72.9
tPOT on one adapter contract leaves a system that cannot mint: the gate needs
the verifier and the feed, so a partial deployment is not a smaller product, it
is a dead one.

## Reproducing this

```bash
cd ~/code/lemo
forge build --sizes

# price and balance
cast gas-price --rpc-url https://test-evm-rpc-v3.portaldot.dev
cast balance 0x884fe7b4Df96D257c23c2DB2077a511C4db2aBf7 \
  --rpc-url https://test-evm-rpc-v3.portaldot.dev

# one creation estimate (ReviveBlake2b256, no constructor args)
BYTECODE=$(jq -r .bytecode.object out/ReviveBlake2b256.sol/ReviveBlake2b256.json)
cast rpc eth_estimateGas \
  "{\"from\":\"0x884fe7b4Df96D257c23c2DB2077a511C4db2aBf7\",\"data\":\"$BYTECODE\"}" \
  --rpc-url https://test-evm-rpc-v3.portaldot.dev
# -> 0xacdf8f9178575 = 3,041,218,981,758,325
```

For a contract with constructor arguments, append
`cast abi-encode "constructor(...)" <args>` to the bytecode before estimating.
`cast estimate --create` in forge 1.8.7 does not accept `--from`, so the raw
`eth_estimateGas` call above is the reliable path.

## Caveats

- These are `eth_estimateGas` values from the public node, not receipts from a
  mined deployment. They include constructor storage writes and the code deposit
  as the node models them. A real deployment can differ by a fraction of a
  percent (two consecutive estimates of `ReviveBlake2b256` differed by ~1,000
  gas out of 3.04 × 10¹⁵ — about 3 × 10⁻¹² relative).
- The storage-deposit side of Revive accounting is not separately broken out by
  the RPC. `eth_estimateGas` returns one gas number that already folds it in;
  that is why per-byte cost (0.0737 tPOT) is close to, but not equal to, the
  0.06 tPOT/byte code-deposit rule in `DEPLOYMENT.md`.
- Constructor arguments used here are placeholders (the deployer as owner and
  attester, `0x11…11` as the title id). Real values change gas only through
  string length and array length.
- The balance drifts: it fell 0.012308 tPOT between the two reads above (blocks
  294,082 → 294,089) without anything from this measurement. Something else
  holds that key. Treat 20.877 as a snapshot, and always re-read the balance
  immediately before funding or deploying.
- The balance is the EVM view. `DEPLOYMENT.md` notes the native account holds
  0.1 tPOT of existential deposit on top of this; the deploy spends from the
  same pool, so do not assume the full 20.877 is spendable at the margin.
