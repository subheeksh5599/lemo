#!/usr/bin/env node
// Capture a Nfts::Item read proof (and an absence proof for a missing item) at a
// finalized block, for test/NativeTitleToken.t.sol. Keyless.
//   node scripts/capture-native-title.mjs <collection> <item> <block> > test/fixtures/native-title.json
import { ApiPromise, WsProvider } from '@polkadot/api'
import { u8aConcat, u8aToHex, bnToU8a } from '@polkadot/util'
import { blake2AsU8a, xxhashAsU8a, decodeAddress, keccakAsU8a } from '@polkadot/util-crypto'
const [c, i, n] = process.argv.slice(2).map(Number)
export const itemKey = (c, i) => {
  const le = (x) => bnToU8a(x, { bitLength: 32, isLe: true })
  return u8aToHex(u8aConcat(xxhashAsU8a('Nfts', 128), xxhashAsU8a('Item', 128), blake2AsU8a(le(c), 128), le(c), blake2AsU8a(le(i), 128), le(i)))
}
const api = await ApiPromise.create({ provider: new WsProvider('wss://test-node-v3.portaldot.dev'), noInitWarn: true })
const hash = await api.rpc.chain.getBlockHash(n)
const header = await api.rpc.chain.getHeader(hash)
const key = itemKey(c, i), missing = itemKey(c, i + 1000)
const [p, q, v] = await Promise.all([api.rpc.state.getReadProof([key], hash), api.rpc.state.getReadProof([missing], hash), api.rpc.state.getStorage(key, hash)])
const owner = u8aToHex(v.unwrap().slice(0, 32))
console.log(JSON.stringify({
  collection: c, item: i, block: n, stateRoot: header.stateRoot.toHex(), key, value: v.unwrap().toHex(), owner,
  ownerEvm: u8aToHex(keccakAsU8a(v.unwrap().slice(0, 32)).slice(12)),
  nodes: p.proof.map((x) => x.toHex()), missingKey: missing, missingNodes: q.proof.map((x) => x.toHex()),
}, null, 2))
await api.disconnect()
