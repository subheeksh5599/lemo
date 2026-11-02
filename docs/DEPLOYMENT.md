# Deploying on Portaldot V3

Read this before funding anything. tPOT is native and an EVM address is not a
native wallet.

## The two accounts

| Thing | Value |
| --- | --- |
| Native token | tPOT, 14 decimals |
| Existential deposit | 0.1 tPOT |
| SS58 prefix | 42 |
| EVM chain id | 420420777 |
| EVM RPC | `https://test-evm-rpc-v3.portaldot.dev` |
| Native RPC | `https://test-node-v3.portaldot.dev` |
| NativeToEthRatio | 10,000 (native base unit -> EVM wei) |

An EVM address does not receive tPOT directly. V3 maps an eth-derived account as:

```
native account id = H160 (20 bytes) ++ 12 bytes of 0xEE
```

That account is the one that holds the tPOT which backs the EVM balance. Print it
for any EVM signer:

```bash
node scripts/evm-native-address.mjs 0xYourEvmAddress
```

Send tPOT to that SS58 address. `eth_getBalance` then shows the EVM balance minus
the existential deposit (a native 200 tPOT account reads 199.9 on the EVM RPC).

## Getting tPOT

There is no public faucet. The Portaldot team distributes testnet tPOT in its
Discord, once every 24 hours, to the native SS58 address. Request it for the
mapped address above, not for the 0x address.

The public testnet cost model, measured by another V3 project:

- storage deposit per new storage item: 3.8415 tPOT for a key + value
- code deposit: about 0.06 tPOT per byte plus the code-hash lockup
- a 899 byte contract deployment: 83.232 tPOT of storage deposit, about 0.13 tPOT fee

A deployment of this repository's four contracts is larger than that example;
budget the code-size sum from `forge build --sizes`, not the 899 byte figure.

## Deploying through the native wallet

The funded account is the sr25519 SS58 wallet, not the EVM address. Deploy with
`revive.instantiateWithCode` so the storage deposit comes from native tPOT:

```bash
PORTALDOT_MNEMONIC=... STORAGE_LIMIT_TPOT=500 \
  node scripts/native-deploy.mjs ReviveBlake2b256
```

For EVM bytecode the constructor arguments are appended to the creation code and
the pallet's `data` field stays `0x`. A weight limit above the block maximum
returns `Transaction would exhaust the block limits`; `1.5e12` refTime is safe.

Measured: the 779-byte hasher costs 71.78 tPOT. The 8,553-byte verifier needs
about 675 tPOT; with 462 tPOT remaining the node returns
`StorageDepositNotEnoughFunds`. The full four-contract suite is about 1,349 tPOT.

## Deploying from an EVM key

The Foundry script signs as the EVM key. The key needs its mapped native account
funded, not the 0x address.

```bash
cd ~/code/lemo
# .env.local: PRIVATE_KEY, RPC_URL, the title values and attesters
# .env.local: DEPLOY_CONFIRM=yes
forge script script/Deploy.s.sol \
  --rpc-url "$RPC_URL" \
  --broadcast
```

`script/Deploy.s.sol` refuses unless `DEPLOY_CONFIRM=yes`. It deploys the
Blake2b adapter, the trie verifier, the root feed (single or 2-of-3 threshold),
and the ERC-20 gate.

## Native registry

The title registry is a FRAME pallet, not an EVM contract. The public V3 node does
not expose `ContractsApi_contract_info`, so this endpoint cannot deploy or query a
native WASM contract. Including the pallet in the runtime and upgrading the chain
is a separate operation; see [NATIVE_REGISTRY.md](NATIVE_REGISTRY.md).

## After deployment

1. Put the four addresses in `.env.local` as `NEXT_PUBLIC_*` values.
2. Run `scripts/attest-root.sh` from each attester. It refuses unless every native
   endpoint returns the same finalized root and block.
3. Restart the web app and read the receipt and code at each address before
   wiring any transaction UI.

Nothing in this repository invents a balance, a root or a deployment.
