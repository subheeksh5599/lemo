#!/usr/bin/env node
// Call an EVM contract through the native Revive pallet, signed by the sr25519
// wallet in PORTALDOT_MNEMONIC (read from the environment, never printed).
//   PORTALDOT_MNEMONIC=... node scripts/native-call.mjs <0xcontract> <0xcalldata>
import { ApiPromise, WsProvider } from '@polkadot/api'
import { Keyring } from '@polkadot/keyring'
import { cryptoWaitReady } from '@polkadot/util-crypto'
const [dest, data] = process.argv.slice(2)
if (!/^0x[0-9a-fA-F]{40}$/.test(dest ?? '') || !/^0x[0-9a-fA-F]*$/.test(data ?? '')) { console.error('usage: native-call.mjs <0xcontract> <0xcalldata>'); process.exit(1) }
if (!process.env.PORTALDOT_MNEMONIC) { console.error('PORTALDOT_MNEMONIC is required'); process.exit(1) }
await cryptoWaitReady()
const signer = new Keyring({ type: 'sr25519', ss58Format: 42 }).addFromUri(process.env.PORTALDOT_MNEMONIC)
const api = await ApiPromise.create({ provider: new WsProvider('wss://test-node-v3.portaldot.dev'), noInitWarn: true })
const weight = api.createType('SpWeightsWeightV2Weight', { refTime: '1500000000000', proofSize: '1000000000000000000' })
const limit = BigInt(process.env.STORAGE_LIMIT_TPOT ?? '5') * 10n ** 14n
const tx = api.tx.revive.call(dest, 0n, weight, limit, data)
await new Promise((resolve, reject) => {
  tx.signAndSend(signer, ({ status, events, dispatchError }) => {
    if (dispatchError) {
      const d = dispatchError.isModule ? api.registry.findMetaError(dispatchError.asModule) : null
      return reject(new Error(d ? `${d.section}.${d.name}` : dispatchError.toString()))
    }
    if (status.isInBlock) {
      console.log('in block', status.asInBlock.toHex(), 'extrinsic', tx.hash.toHex())
      for (const { event } of events) if (event.section === 'transactionPayment') console.log('fee', event.data.toHuman())
    }
    if (status.isFinalized) { console.log('finalized', status.asFinalized.toHex()); resolve() }
  }).catch(reject)
})
await api.disconnect()
