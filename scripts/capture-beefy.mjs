/**
 * Capture a real BEEFY-finalized block from Portaldot V3 as a test fixture for
 * contracts/BeefyRootFeed.sol, and export the helpers the relayer reuses.
 *
 * What a fixture holds (everything read from the chain, nothing synthesised):
 *   - the SCALE `Commitment` from the block's BEEFY justification ('BEEF',
 *     VersionedFinalityProof V1) and the ECDSA signatures in it;
 *   - the BEEFY authority set that signed it: compressed keys and the Ethereum
 *     addresses (keccak of the uncompressed key) the contract checks against;
 *   - the newest-leaf MMR proof: leaf count at block N and the MMR peaks as
 *     stored on chain (`Mmr::Nodes`) at block N-1;
 *   - the SCALE header of block N-1 (the leaf's parent block), its state root;
 *   - `state_getReadProof` at block N-1 for System.Number,
 *     MmrLeaf.BeefyAuthorities and MmrLeaf.BeefyNextAuthorities.
 *
 * Every derived value is checked here before it is written: the MMR root the
 * peaks reconstruct must equal the commitment's 'mh' payload, the header must
 * hash to the parent hash, each signature must recover to an authority, and the
 * authority addresses must merkle-hash to the chain's keyset commitment.
 *
 * Why newest-leaf and not `mmr_generateProof`: the public V3 node answers every
 * `mmr_generateProof` with `8011 LeafNotFound` (MMR leaves and inner nodes live
 * only in the offchain DB, and that node does not run with offchain indexing).
 * On-chain `Mmr::Nodes` keeps only the peaks, which is exactly what proving the
 * newest leaf needs. See docs/FINALITY.md.
 *
 * Usage:
 *   node scripts/capture-beefy.mjs latest   [out.json]
 *   node scripts/capture-beefy.mjs block <N> [out.json]
 *   node scripts/capture-beefy.mjs rotation [preOut.json] [postOut.json]
 */

import { ApiPromise, WsProvider } from '@polkadot/api'
import { blake2AsU8a, keccakAsU8a, secp256k1Expand, secp256k1Recover, cryptoWaitReady } from '@polkadot/util-crypto'
import { hexToU8a, u8aConcat, u8aToHex, u8aEq } from '@polkadot/util'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const ENDPOINT = process.env.PORTALDOT_WS ?? 'wss://test-node-v3.portaldot.dev'
const BEEF = '0x42454546'

// ------------------------------------------------------------------ SCALE

export function readCompact(u8, off) {
  const b = u8[off]
  const mode = b & 3
  if (mode === 0) return [b >> 2, off + 1]
  if (mode === 1) return [(b | (u8[off + 1] << 8)) >>> 2, off + 2]
  if (mode === 2) return [(b | (u8[off + 1] << 8) | (u8[off + 2] << 16) | (u8[off + 3] << 24)) >>> 2, off + 4]
  throw new Error('big compact not expected here')
}

const le = (u8, off, n) => {
  let v = 0n
  for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(u8[off + i])
  return v
}
const u32le = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b }

/**
 * Split a VersionedFinalityProof::V1 into the SCALE commitment and the
 * signatures. Signatures use sp-consensus-beefy's compact encoding:
 * signatures_from (bitfield, MSB first), validator_set_len u32, Vec<[u8;65]>.
 */
export function decodeBeefyJustification(hex) {
  const u8 = hexToU8a(hex)
  if (u8[0] !== 1) throw new Error(`unexpected VersionedFinalityProof version ${u8[0]}`)
  let off = 1
  const start = off
  const [entries, o1] = readCompact(u8, off); off = o1
  const payload = []
  for (let i = 0; i < entries; i++) {
    const id = String.fromCharCode(u8[off], u8[off + 1]); off += 2
    const [len, o2] = readCompact(u8, off); off = o2
    payload.push({ id, data: u8aToHex(u8.slice(off, off + len)) }); off += len
  }
  const blockNumber = Number(le(u8, off, 4)); off += 4
  const validatorSetId = Number(le(u8, off, 8)); off += 8
  const commitment = u8.slice(start, off)
  const [bfLen, o3] = readCompact(u8, off); off = o3
  const bitfield = u8.slice(off, off + bfLen); off += bfLen
  const setLen = Number(le(u8, off, 4)); off += 4
  const [sigCount, o4] = readCompact(u8, off); off = o4
  const sigs = []
  for (let i = 0; i < sigCount; i++) { sigs.push(u8.slice(off, off + 65)); off += 65 }
  if (off !== u8.length) throw new Error('trailing bytes in justification')
  const signers = []
  for (let i = 0; i < setLen; i++) if (bitfield[i >> 3] & (0x80 >> (i & 7))) signers.push(i)
  if (signers.length !== sigs.length) throw new Error('bitfield and signature count disagree')
  const mh = payload.find((p) => p.id === 'mh')
  if (!mh || hexToU8a(mh.data).length !== 32) throw new Error('no 32 byte mh payload')
  return { commitment, payload, blockNumber, validatorSetId, mmrRoot: mh.data, setLen, signers, sigs }
}

// ------------------------------------------------------------------ MMR

const popcount = (x) => { let c = 0; while (x > 0) { c += x & 1; x = Math.floor(x / 2) } return c }

/** ckb-merkle-mountain-range peak positions (0 based) for an MMR of `leaves`. */
export function peakPositions(leaves) {
  const size = 2 * leaves - popcount(leaves)
  const out = []
  let h = 0
  while (2 ** (h + 1) - 1 <= size) h++
  let peak = 2 ** h - 1
  let acc = 0
  while (peak > 0) {
    if (acc + peak <= size) { out.push(acc + peak - 1); acc += peak }
    peak = (peak + 1) / 2 - 1
  }
  return out
}

/** Root after appending `leafHash` to an MMR whose peaks (left to right) are `peaks`. */
export function newestLeafRoot(peaks, leafCountAfter, leafHash) {
  const ps = peaks.slice()
  let h = leafHash
  let before = leafCountAfter - 1
  while (before % 2 === 1) { h = keccakAsU8a(u8aConcat(ps.pop(), h)); before = Math.floor(before / 2) }
  ps.push(h)
  // ckb bag_rhs_peaks with substrate's Merge: root = keccak(right || left), right to left.
  let root = ps[ps.length - 1]
  for (let i = ps.length - 2; i >= 0; i--) root = keccakAsU8a(u8aConcat(root, ps[i]))
  return root
}

/** sp binary_merkle_tree::merkle_root over 20 byte addresses, keccak, no sorting. */
export function keysetCommitment(addresses) {
  let layer = addresses.map((a) => keccakAsU8a(hexToU8a(a)))
  if (layer.length === 0) return new Uint8Array(32)
  while (layer.length > 1) {
    const next = []
    for (let i = 0; i < layer.length; i += 2) {
      next.push(i + 1 < layer.length ? keccakAsU8a(u8aConcat(layer[i], layer[i + 1])) : layer[i])
    }
    layer = next
  }
  return layer[0]
}

export const ethAddress = (compressedHex) => u8aToHex(keccakAsU8a(secp256k1Expand(hexToU8a(compressedHex))).slice(12))

// ------------------------------------------------------------------ capture

export async function connect() {
  await cryptoWaitReady()
  return ApiPromise.create({ provider: new WsProvider(ENDPOINT), noInitWarn: true })
}

export async function beefyJustificationAt(api, hash) {
  const blk = await api.rpc.chain.getBlock(hash)
  if (blk.justifications.isNone) return null
  const j = blk.justifications.unwrap().toJSON().find((x) => x[0] === BEEF)
  return j ? j[1] : null
}

/** Most recent block at or below `from` carrying a BEEFY justification. */
export async function findJustified(api, from, floor = from - 64) {
  for (let b = from; b > floor; b--) {
    const h = await api.rpc.chain.getBlockHash(b)
    const j = await beefyJustificationAt(api, h)
    if (j) return { number: b, hash: h.toHex(), justification: j }
  }
  throw new Error(`no BEEFY justification between ${floor + 1} and ${from}`)
}

async function readProof(api, key, at) {
  const proof = await api.rpc.state.getReadProof([key], at)
  const value = await api.rpc.state.getStorage(key, at)
  return { key, value: value.toHex(), nodes: proof.proof.map((n) => n.toHex()) }
}

/**
 * Everything `BeefyRootFeed.submit` needs for BEEFY-justified block `n`, each
 * piece checked against the chain. Throws on any mismatch.
 */
export async function buildSubmission(api, n) {
  const hashN = (await api.rpc.chain.getBlockHash(n)).toHex()
  const just = await beefyJustificationAt(api, hashN)
  if (!just) throw new Error(`block ${n} has no BEEFY justification`)
  const d = decodeBeefyJustification(just)
  if (d.blockNumber !== n) throw new Error('justification block number mismatch')

  const parent = n - 1
  const hashP = (await api.rpc.chain.getBlockHash(parent)).toHex()
  const atN = await api.at(hashN)
  const atP = await api.at(hashP)

  // Header of N-1: SCALE bytes must hash to the block hash.
  const header = await api.rpc.chain.getHeader(hashP)
  const headerBytes = header.toU8a()
  if (u8aToHex(blake2AsU8a(headerBytes, 256)) !== hashP) throw new Error('header does not hash to parent hash')

  // Newest-leaf MMR proof: the leaf is SCALE((u32 number, H256 hash)) of N-1.
  const leafCount = (await atN.query.mmr.numberOfLeaves()).toNumber()
  const before = (await atP.query.mmr.numberOfLeaves()).toNumber()
  if (before + 1 !== leafCount) throw new Error('leaf count did not grow by one')
  const peaks = []
  for (const pos of peakPositions(before)) peaks.push((await atP.query.mmr.nodes(pos)).unwrap().toU8a())
  const leaf = u8aConcat(u32le(parent), hexToU8a(hashP))
  const root = newestLeafRoot(peaks, leafCount, keccakAsU8a(leaf))
  if (u8aToHex(root) !== d.mmrRoot) throw new Error(`MMR root mismatch ${u8aToHex(root)} != ${d.mmrRoot}`)
  if ((await atN.query.mmr.rootHash()).toHex() !== d.mmrRoot) throw new Error('Mmr::RootHash differs from mh payload')

  // The signing set: the state at N reports the set that signs N (the
  // mandatory first block of a session is signed by the new set).
  const setIdAtN = (await atN.query.beefy.validatorSetId()).toNumber()
  if (setIdAtN !== d.validatorSetId) throw new Error(`state set ${setIdAtN} != commitment set ${d.validatorSetId}`)
  const compressed = (await atN.query.beefy.authorities()).toJSON()
  const addresses = compressed.map(ethAddress)
  const mmrAuth = (await atN.query.mmrLeaf.beefyAuthorities()).toJSON()
  if (mmrAuth.id !== d.validatorSetId || mmrAuth.len !== addresses.length) throw new Error('MmrLeaf.BeefyAuthorities disagrees')
  if (u8aToHex(keysetCommitment(addresses)) !== mmrAuth.keysetCommitment) throw new Error('keyset commitment mismatch')
  if (d.setLen !== addresses.length) throw new Error('justification set length != authorities')

  const msg = keccakAsU8a(d.commitment)
  d.sigs.forEach((sig, i) => {
    const pub = secp256k1Recover(msg, sig.slice(0, 64), sig[64] >= 27 ? sig[64] - 27 : sig[64])
    if (!u8aEq(pub, hexToU8a(compressed[d.signers[i]]))) throw new Error(`signature ${i} does not recover to authority ${d.signers[i]}`)
  })

  const proofs = {
    systemNumber: await readProof(api, api.query.system.number.key(), hashP),
    beefyAuthorities: await readProof(api, api.query.mmrLeaf.beefyAuthorities.key(), hashP),
    beefyNextAuthorities: await readProof(api, api.query.mmrLeaf.beefyNextAuthorities.key(), hashP),
  }
  if (Number(le(hexToU8a(proofs.systemNumber.value), 0, 4)) !== parent) throw new Error('System.Number value != parent number')

  const decodeSet = (hex) => {
    const u = hexToU8a(hex)
    return { id: Number(le(u, 0, 8)), len: Number(le(u, 8, 4)), keysetCommitment: u8aToHex(u.slice(12, 44)) }
  }

  return {
    capturedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    source: `live RPC ${ENDPOINT}: chain_getBlock(${n}).justifications['BEEF'], chain_getHeader(${parent}), Mmr::Nodes at ${parent}, state_getReadProof at ${parent}`,
    genesisHash: (await api.rpc.chain.getBlockHash(0)).toHex(),
    specVersion: api.runtimeVersion.specVersion.toNumber(),
    beefyBlock: { number: n, hash: hashN },
    justification: just,
    commitment: u8aToHex(d.commitment),
    commitmentBlockNumber: d.blockNumber,
    validatorSetId: d.validatorSetId,
    mmrRoot: d.mmrRoot,
    signers: d.signers,
    signatures: d.sigs.map((s) => u8aToHex(s)),
    signaturesPacked: u8aToHex(u8aConcat(...d.sigs)),
    authorities: { setId: d.validatorSetId, compressed, ethAddresses: addresses, keysetCommitment: mmrAuth.keysetCommitment, readAt: hashN },
    mmr: {
      path: 'newest-leaf: peaks of the MMR at N-1 (on-chain Mmr::Nodes) + leaf of N-1; mmr_generateProof is LeafNotFound on the public node',
      leafCount,
      leaf: u8aToHex(leaf),
      leafHash: u8aToHex(keccakAsU8a(leaf)),
      peaks: peaks.map((p) => u8aToHex(p)),
    },
    header: { number: parent, hash: hashP, hex: u8aToHex(headerBytes), parentHash: header.parentHash.toHex(), stateRoot: header.stateRoot.toHex() },
    proofs,
    beefyAuthoritiesAtHeader: decodeSet(proofs.beefyAuthorities.value),
    beefyNextAuthoritiesAtHeader: decodeSet(proofs.beefyNextAuthorities.value),
  }
}

async function setIdAt(api, n) {
  return (await (await api.at(await api.rpc.chain.getBlockHash(n))).query.beefy.validatorSetId()).toNumber()
}

/** First block of the most recent completed set change at or below `head`. */
export async function findSetStart(api, head) {
  const cur = await setIdAt(api, head)
  let lo = head - 1000
  while ((await setIdAt(api, lo)) === cur) lo -= 1000
  let hi = head
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if ((await setIdAt(api, m)) === cur) hi = m
    else lo = m
  }
  return { start: hi, setId: cur }
}

const write = (file, obj) => { writeFileSync(file, JSON.stringify(obj, null, 2) + '\n'); console.log('wrote', file) }

async function main() {
  const [mode = 'latest', a, b] = process.argv.slice(2)
  const api = await connect()
  try {
    const head = (await api.rpc.chain.getHeader(await api.rpc.beefy.getFinalizedHead())).number.toNumber()
    if (mode === 'latest') {
      const j = await findJustified(api, head)
      const fx = await buildSubmission(api, j.number)
      write(a ?? 'test/fixtures/beefy-latest.json', fx)
    } else if (mode === 'block') {
      const fx = await buildSubmission(api, Number(a))
      write(b ?? `test/fixtures/beefy-${a}.json`, fx)
    } else if (mode === 'rotation') {
      // The mandatory first block of set k+1 is signed by k+1; the last
      // justified block before it is signed by k and its header state names
      // set k+1 in MmrLeaf.BeefyNextAuthorities.
      const { start, setId } = await findSetStart(api, head)
      const pre = await findJustified(api, start - 1)
      const preFx = await buildSubmission(api, pre.number)
      const postFx = await buildSubmission(api, start)
      if (preFx.validatorSetId + 1 !== postFx.validatorSetId || postFx.validatorSetId !== setId) throw new Error('not a one step rotation')
      if (preFx.beefyNextAuthoritiesAtHeader.id !== postFx.validatorSetId) throw new Error('pre header does not name the next set')
      write(a ?? 'test/fixtures/beefy-rotation-pre.json', preFx)
      write(b ?? 'test/fixtures/beefy-rotation-post.json', postFx)
    } else {
      throw new Error(`unknown mode ${mode}`)
    }
  } finally {
    await api.disconnect()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
