#!/usr/bin/env node
// Create a native title on public Portaldot V3: an `nfts` collection and item
// owned by the sr25519 wallet in PORTALDOT_MNEMONIC (env only, never printed).
//   PORTALDOT_MNEMONIC=... node scripts/native-title.mjs            # new collection + item 0
//   PORTALDOT_MNEMONIC=... node scripts/native-title.mjs transfer <collection> <item> <ss58>
import { ApiPromise, WsProvider } from '@polkadot/api'
import { Keyring } from '@polkadot/keyring'
import { cryptoWaitReady } from '@polkadot/util-crypto'
if (!process.env.PORTALDOT_MNEMONIC) { console.error('PORTALDOT_MNEMONIC is required'); process.exit(1) }
await cryptoWaitReady()
const me = new Keyring({ type: 'sr25519', ss58Format: 42 }).addFromUri(process.env.PORTALDOT_MNEMONIC)
const api = await ApiPromise.create({ provider: new WsProvider('wss://test-node-v3.portaldot.dev'), noInitWarn: true })
const [cmd, ...rest] = process.argv.slice(2)
let tx
if (cmd === 'transfer') {
  const [c, i, to] = rest
  tx = api.tx.nfts.transfer(Number(c), Number(i), to)
} else {
  const collection = (await api.query.nfts.nextCollectionId()).unwrapOr(0).toNumber()
  const config = { settings: 0, maxSupply: null, mintSettings: { mintType: 'Issuer', price: null, startBlock: null, endBlock: null, defaultItemSettings: 0 } }
  tx = api.tx.utility.batchAll([api.tx.nfts.create(me.address, config), api.tx.nfts.mint(collection, 0, me.address, null)])
  console.log('collection', collection, 'item 0')
}
await new Promise((resolve, reject) => {
  tx.signAndSend(me, (r) => {
    if (r.dispatchError) { const d = r.dispatchError.isModule ? api.registry.findMetaError(r.dispatchError.asModule) : null; return reject(new Error(d ? `${d.section}.${d.name}` : r.dispatchError.toString())) }
    if (r.status.isInBlock) api.rpc.chain.getHeader(r.status.asInBlock).then((h) => { console.log('extrinsic', `${h.number.toNumber()}-${r.txIndex}`); resolve() })
  }).catch(reject)
})
await api.disconnect()
