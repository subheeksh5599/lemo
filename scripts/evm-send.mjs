#!/usr/bin/env node
// Send native tPOT from an EVM key to an EVM address (a mapped native account
// receives it on its SS58 side). The key comes from RELAYER_PRIVATE_KEY only.
//   RELAYER_PRIVATE_KEY=0x… node scripts/evm-send.mjs <0xto> <tPOT>
// Revive's EVM side counts value in 18 decimals; tPOT has 14, so 1 tPOT = 1e18 wei here.
import { hexToU8a } from '@polkadot/util'
import { evmAddressOf, signLegacyTx } from './relay-beefy.mjs'

const [to, amount] = process.argv.slice(2)
const key = process.env.RELAYER_PRIVATE_KEY
if (!/^0x[0-9a-fA-F]{40}$/.test(to ?? '') || !(Number(amount) > 0) || !key) {
  console.error('usage: RELAYER_PRIVATE_KEY=0x… node scripts/evm-send.mjs <0xto> <tPOT>')
  process.exit(1)
}
const RPC = process.env.EVM_RPC ?? 'https://test-evm-rpc-v3.portaldot.dev'
let id = 0
const evm = async (method, params) => {
  const r = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })).json()
  if (r.error) throw new Error(`${method}: ${r.error.message}`)
  return r.result
}
const secret = hexToU8a(key)
const from = evmAddressOf(secret)
const value = BigInt(Math.round(Number(amount) * 1e6)) * 10n ** 12n
const chainId = BigInt(await evm('eth_chainId', []))
const nonce = BigInt(await evm('eth_getTransactionCount', [from, 'pending']))
const latest = await evm('eth_getBlockByNumber', ['latest', false])
const gasPrice = BigInt(latest.baseFeePerGas ?? '0x3b9aca00') * 2n
const gas = (BigInt(await evm('eth_estimateGas', [{ from, to, value: `0x${value.toString(16)}` }])) * 12n) / 10n
const raw = signLegacyTx({ nonce, gasPrice, gas, to, data: '0x', chainId, value }, secret)
const hash = await evm('eth_sendRawTransaction', [raw])
for (let i = 0; i < 40; i++) {
  const r = await evm('eth_getTransactionReceipt', [hash])
  if (r) {
    console.log(`sent ${amount} tPOT from ${from} to ${to}: ${hash}, block ${BigInt(r.blockNumber)}, status ${r.status}`)
    process.exit(r.status === '0x1' ? 0 : 1)
  }
  await new Promise((res) => setTimeout(res, 3000))
}
throw new Error(`${hash} not included`)
