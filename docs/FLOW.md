# The transaction console

`/console/flow` is the write side of the console. It is a real transaction surface,
not a preview: it builds calldata, asks the connected wallet to sign, and polls the
Revive receipt.

## What it needs

The page reads three addresses at build time:

```bash
NEXT_PUBLIC_LEMO_GATE=0x...
NEXT_PUBLIC_LEMO_VERIFIER=0x...
NEXT_PUBLIC_LEMO_FEED=0x...
NEXT_PUBLIC_EVM_EXPLORER=   # optional
```

An empty variable is a rendered state, not a placeholder. The page names the
missing variable and disables the action. A configured address with no code is a
separate state.

## Panels

- **Wallet dock** — one EVM account and one Substrate account can be connected at
  the same time. The menu never invents a provider.
- **Deployment** — shows which slots are set, missing or codeless.
- **Funding** — maps the EVM signer to its native SS58 account with
  `ReviveApi_account_id`, then reads both `ReviveApi_balance` and `eth_getBalance`.
  The two balances have different decimals; the panel says so rather than
  normalising one into the other.
- **Action** — mint and transfer. It simulates with `eth_call` from the signer; the live gate is paused, so the production page surfaces `GateIsPaused` rather than a fake success
  before opening the wallet. A revert is decoded into the contract's custom error.
- **Verify** — read-only `verifyTitle` and `commitmentOf`; no wallet needed.

## What it does not do

- It does not deploy contracts. Deployment is `scripts/native-deploy.mjs` or
  `forge script`, both of which need the native balance.
- It does not make a proof. Proofs come from `scripts/attest-root.sh` (root feed)
  and the proof service (`server/`).
- It does not hide a failed transaction. The receipt status, hash and block are
  rendered, and the explorer link is omitted when the explorer variable is empty.
