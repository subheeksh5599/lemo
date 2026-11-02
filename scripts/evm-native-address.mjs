#!/usr/bin/env node
// Print the native SS58 account that a Revive EVM address is funded through.
//
// V3 maps an eth-derived account as H160 ++ 12 bytes of 0xEE (pallet-revive
// AccountId32Mapper). tPOT is native, 14 decimals, SS58 prefix 42. Send tPOT to
// this SS58 address, not to the 0x address.
//
// Usage:
//   node scripts/evm-native-address.mjs 0xYourEvmAddress
//   NATIVE_RPC=wss://... node scripts/evm-native-address.mjs 0x...

import { encodeAddress } from '@polkadot/util-crypto'
import { hexToU8a } from '@polkadot/util'

const address = process.argv[2]
if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
  console.error('usage: node scripts/evm-native-address.mjs 0x<40 hex chars>')
  process.exit(1)
}

const rpc = process.env.NATIVE_RPC ?? 'https://test-node-v3.portaldot.dev'
const body = {
  jsonrpc: '2.0',
  id: 1,
  method: 'state_call',
  params: ['ReviveApi_account_id', address.slice(2)],
}

const response = await fetch(rpc, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
const payload = await response.json()

if (typeof payload.result !== 'string') {
  console.error(payload.error?.message ?? 'the node did not return an account id')
  process.exit(1)
}

const accountId = hexToU8a(payload.result)
if (accountId.length !== 32) {
  console.error(`expected a 32 byte account id, got ${accountId.length} bytes`)
  process.exit(1)
}

console.log(encodeAddress(accountId, 42))
