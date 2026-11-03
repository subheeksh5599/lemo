/**
 * One complete local LEMO lifecycle, real transactions only.
 *
 *   native (local solochain, ws://127.0.0.1:9944)       EVM (anvil, http://127.0.0.1:8545)
 *   ---------------------------------------------       ----------------------------------
 *   create_title (salted id, deposit reserved)
 *   set_representation -> predicted gate address
 *   sudo set_representation_live(true)
 *   wait for a GRANDPA justification, capture proof A
 *                                                        deploy hasher, verifier, feed, gate, guard
 *                                                        attest root A, mint full cap, transfer
 *   request_unbond -> refused (RepresentationLive)
 *                                                        UnbondGuard.requestUnbond -> reverted
 *   wait for a later justification, capture proof B
 *                                                        attest root B, transfer back, burn,
 *                                                        UnbondGuard request + complete
 *   sudo set_representation_live(false)
 *   request_unbond -> ok, finalize early -> refused
 *   wait UnbondingPeriod, finalize_unbond -> ok
 *   capture proof C: the canonical key is now absent
 *
 * Keys: //Alice and //Bob are the public Substrate development keys; the EVM
 * accounts are anvil's unlocked default accounts (public test keys, used
 * through eth_sendTransaction, so no key is handled here). Nothing secret is
 * written to the fixture.
 *
 * Needs: a fresh `solochain-template-node --dev --tmp`, a fresh `anvil`, and
 * `forge build` run in local-evm/ (the script reads local-evm/out).
 *
 * Usage: node scripts/local-e2e.mjs [out=fixtures/local-e2e.json]
 */

import { ApiPromise, WsProvider } from '@polkadot/api'
import { Keyring } from '@polkadot/keyring'
import { u8aConcat, u8aToHex, hexToU8a } from '@polkadot/util'
import { blake2AsHex, blake2AsU8a, cryptoWaitReady, decodeAddress, ed25519Verify } from '@polkadot/util-crypto'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = process.argv[2] ?? join(ROOT, 'fixtures/local-e2e.json')
const WS = process.env.LEMO_WS ?? 'ws://127.0.0.1:9944'
const ANVIL = process.env.LEMO_ANVIL ?? 'http://127.0.0.1:8545'
const CAST = process.env.CAST ?? `${process.env.HOME}/.foundry/bin/cast`

// anvil's default accounts 0..2 (public test accounts).
const DEPLOYER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const BENEFICIARY = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const BOB_EVM = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'

const OP = { transfer: 1, mint: 2, burn: 3 }
const MAX_SUPPLY = 1000n * 10n ** 18n
const TRANSFER = 400n * 10n ** 18n
const PROOF_TUPLE = '(bytes32,uint256,uint64,address,uint8,bytes32,bytes,bytes[])'

const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------ EVM side

function cast(...args) {
  return execFileSync(CAST, args, { encoding: 'utf8', maxBuffer: 64 << 20 }).trim()
}

async function rpc(method, params = []) {
  const res = await fetch(ANVIL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return res.json()
}

function artifact(file, name) {
  const json = JSON.parse(readFileSync(join(ROOT, 'local-evm/out', file, `${name}.json`), 'utf8'))
  return { abi: json.abi, bytecode: json.bytecode.object }
}

/** selector -> signature, for every custom error the deployed contracts declare. */
const ERRORS = new Map()
function learnErrors(abi) {
  for (const item of abi) {
    if (item.type !== 'error') continue
    const sig = `${item.name}(${item.inputs.map((i) => i.type).join(',')})`
    ERRORS.set(cast('sig', sig).toLowerCase(), sig)
  }
}

function decodeRevert(data) {
  if (typeof data !== 'string' || data.length < 10) return { selector: null, error: 'no revert data' }
  const selector = data.slice(0, 10).toLowerCase()
  const sig = ERRORS.get(selector)
  if (!sig) return { selector, error: `unknown selector ${selector}`, data }
  let args = []
  if (sig.includes('()') === false) {
    try {
      args = cast('decode-error', '--sig', sig, data).split('\n').filter(Boolean)
    } catch {
      args = []
    }
  }
  return { selector, error: sig, args, data }
}

const evmSteps = []

/**
 * Send from an unlocked anvil account and record the receipt. `expectRevert`
 * forces a fixed gas limit so the reverting call is mined as a real failed
 * transaction rather than refused at estimation.
 */
async function send(label, { from, to, data, expectRevert = false }) {
  const tx = { from, data }
  if (to) tx.to = to
  const call = await rpc('eth_call', [tx, 'latest'])
  let revert = null
  if (call.error) {
    revert = decodeRevert(call.error.data)
    if (!expectRevert) throw new Error(`${label} would revert: ${JSON.stringify(revert)}`)
  } else if (expectRevert) {
    throw new Error(`${label} was expected to revert but eth_call succeeded`)
  }
  let gas
  if (expectRevert) gas = '0x1c9c380' // 30,000,000
  else {
    const est = await rpc('eth_estimateGas', [tx])
    if (est.error) throw new Error(`${label} estimate: ${JSON.stringify(est.error)}`)
    gas = '0x' + ((BigInt(est.result) * 12n) / 10n).toString(16)
  }
  const sent = await rpc('eth_sendTransaction', [{ ...tx, gas }])
  if (sent.error) throw new Error(`${label} send: ${JSON.stringify(sent.error)}`)
  let receipt = null
  for (let i = 0; i < 50 && receipt === null; i += 1) {
    receipt = (await rpc('eth_getTransactionReceipt', [sent.result])).result
    if (receipt === null) await sleep(100)
  }
  const step = {
    label,
    from,
    to: to ?? null,
    txHash: sent.result,
    blockNumber: Number(BigInt(receipt.blockNumber)),
    blockHash: receipt.blockHash,
    status: receipt.status === '0x1' ? 'success' : 'reverted',
    gasUsed: Number(BigInt(receipt.gasUsed)),
    contractAddress: receipt.contractAddress ?? null,
    revert,
    logs: receipt.logs.length,
  }
  if (expectRevert && step.status !== 'reverted') throw new Error(`${label} did not revert`)
  if (!expectRevert && step.status !== 'success') throw new Error(`${label} reverted on chain`)
  evmSteps.push(step)
  log('evm', label, step.status, step.txHash, 'block', step.blockNumber)
  return step
}

async function deploy(label, art, ctorSig, ...ctorArgs) {
  learnErrors(art.abi)
  const args = ctorSig ? cast('abi-encode', ctorSig, ...ctorArgs).slice(2) : ''
  const step = await send(label, { from: DEPLOYER, data: art.bytecode + args })
  return step.contractAddress
}

function call(to, sig, ...args) {
  return cast('call', '--rpc-url', ANVIL, to, sig, ...args).split(' ')[0]
}

function proofArg(capture, gate, op) {
  return `(${capture.titleId},${capture.chainId},${capture.revision},${gate},${op},${capture.header.stateRoot},${capture.storageKey},[${capture.proofNodes.join(',')}])`
}

function calldata(sig, ...args) {
  return cast('calldata', sig, ...args)
}

// --------------------------------------------------------------- native side

let api
const nativeSteps = []

function moduleError(dispatchError) {
  if (dispatchError.isModule) {
    const meta = api.registry.findMetaError(dispatchError.asModule)
    return { pallet: meta.section, error: meta.name, docs: meta.docs.join(' ').trim(), index: dispatchError.asModule.toHuman() }
  }
  return { pallet: null, error: dispatchError.toString(), docs: '', index: null }
}

/** Submit, wait until in a block, and record hash, block, index, events and outcome. */
async function submit(label, tx, signer, { expectFailure = false } = {}) {
  const result = await new Promise((resolve, reject) => {
    let unsub
    tx.signAndSend(signer, (res) => {
      if (res.status.isInBlock) {
        if (unsub) unsub()
        resolve(res)
      }
      if (res.isError) reject(new Error(`${label}: ${res.status.toString()}`))
    })
      .then((u) => {
        unsub = u
      })
      .catch(reject)
  })
  const blockHash = result.status.asInBlock.toHex()
  const header = await api.rpc.chain.getHeader(blockHash)
  const block = await api.rpc.chain.getBlock(blockHash)
  const hash = tx.hash.toHex()
  const extrinsicIndex = block.block.extrinsics.findIndex((x) => x.hash.toHex() === hash)
  const events = result.events.map(({ event }) => ({
    name: `${event.section}.${event.method}`,
    data: event.data.toHuman(),
  }))
  let outcome = 'success'
  let error = null
  if (result.dispatchError) {
    outcome = 'failed'
    error = moduleError(result.dispatchError)
  }
  // sudo wraps the inner result in Sudid { sudo_result }.
  const sudid = result.events.find(({ event }) => event.section === 'sudo' && event.method === 'Sudid')
  if (sudid) {
    const inner = sudid.event.data[0]
    if (inner.isErr) {
      outcome = 'failed'
      error = moduleError(inner.asErr)
    }
  }
  const step = {
    label,
    signer: signer.address,
    extrinsicHash: hash,
    blockHash,
    blockNumber: header.number.toNumber(),
    extrinsicIndex,
    outcome,
    error,
    events: events.filter((e) => !e.name.startsWith('transactionPayment') && e.name !== 'system.ExtrinsicSuccess'),
  }
  if (expectFailure && outcome !== 'failed') throw new Error(`${label} was expected to fail`)
  if (!expectFailure && outcome !== 'success') throw new Error(`${label} failed: ${JSON.stringify(error)}`)
  nativeSteps.push(step)
  log('native', label, outcome, error ? `${error.pallet}.${error.error}` : '', hash, '#' + step.blockNumber)
  return step
}


function decodeJustification(hex) {
  const b = hexToU8a(hex)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let o = 0
  const round = dv.getBigUint64(o, true)
  o += 8
  const targetHash = u8aToHex(b.subarray(o, o + 32))
  o += 32
  const targetNumber = dv.getUint32(o, true)
  o += 4
  const [len, lenBytes] = compact(b, o)
  o += lenBytes
  const precommits = []
  for (let i = 0; i < len; i += 1) {
    const pHash = u8aToHex(b.subarray(o, o + 32))
    const pNumber = dv.getUint32(o + 32, true)
    const signature = u8aToHex(b.subarray(o + 36, o + 100))
    const id = u8aToHex(b.subarray(o + 100, o + 132))
    precommits.push({ targetHash: pHash, targetNumber: pNumber, signature, id })
    o += 132
  }
  return { round: round.toString(), targetHash, targetNumber, precommits }
}

function compact(b, o) {
  const mode = b[o] & 3
  if (mode === 0) return [b[o] >> 2, 1]
  if (mode === 1) return [(b[o] | (b[o + 1] << 8)) >> 2, 2]
  if (mode === 2) return [(b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 2, 4]
  throw new Error('big compact not expected here')
}

function precommitMessage(targetHash, targetNumber, round, setId) {
  const m = new Uint8Array(1 + 32 + 4 + 8 + 8)
  const dv = new DataView(m.buffer)
  m[0] = 1 // Message::Precommit
  m.set(hexToU8a(targetHash), 1)
  dv.setUint32(33, targetNumber, true)
  dv.setBigUint64(37, BigInt(round), true)
  dv.setBigUint64(45, BigInt(setId), true)
  return m
}

/**
 * The first finalized block at or above `minNumber` that carries a stored
 * GRANDPA justification (engine id FRNK) in `chain_getBlock`. The node keeps
 * one per commit target when run with LEMO_GRANDPA_JUSTIFICATION_PERIOD=1.
 */
async function waitJustification(minNumber, label) {
  log('waiting for a finalized block with a GRANDPA justification at or above #' + minNumber, `(${label})`)
  let next = minNumber
  for (let i = 0; i < 900; i += 1) {
    const head = await api.rpc.chain.getFinalizedHead()
    const finalized = (await api.rpc.chain.getHeader(head)).number.toNumber()
    for (; next <= finalized; next += 1) {
      const hash = await api.rpc.chain.getBlockHash(next)
      const block = await api.rpc.chain.getBlock(hash)
      const just = block.justifications.isSome
        ? block.justifications.unwrap().find(([engine]) => u8aToHex(engine) === '0x46524e4b')
        : undefined
      if (just) {
        const encoded = just[1].toHex()
        return { encoded, decoded: decodeJustification(encoded), source: 'chain_getBlock justifications FRNK' }
      }
    }
    await sleep(500)
  }
  throw new Error(`no justification at or above #${minNumber}`)
}

/** Header, justification, read proof and value for the canonical key at a finalized block. */
async function captureAt(label, minNumber, titleId) {
  const j = await waitJustification(minNumber, label)
  const hash = j.decoded.targetHash
  const header = await api.rpc.chain.getHeader(hash)
  const encodedHeader = header.toHex()
  if (blake2AsHex(hexToU8a(encodedHeader), 256) !== hash) throw new Error('header does not hash to the justified block')
  const finalizedHead = await api.rpc.chain.getFinalizedHead()
  const finalizedNumber = (await api.rpc.chain.getHeader(finalizedHead)).number.toNumber()
  if (finalizedNumber < header.number.toNumber()) throw new Error('justified block is not finalized yet')
  const at = await api.at(hash)
  const setId = (await at.query.grandpa.currentSetId()).toString()
  let authorities
  try {
    authorities = await at.call.grandpaApi.grandpaAuthorities()
  } catch {
    authorities = await api.call.grandpaApi.grandpaAuthorities()
  }
  const authorityList = authorities.map(([id, weight]) => ({ id: id.toHex(), weight: weight.toString() }))

  // Verify here too, so a capture that would fail in the browser fails now.
  for (const p of j.decoded.precommits) {
    const msg = precommitMessage(p.targetHash, p.targetNumber, j.decoded.round, setId)
    if (!ed25519Verify(msg, p.signature, p.id)) throw new Error('precommit signature did not verify')
  }

  const key = api.query.lemoTitle.canonicalTitles.key(titleId)
  const storageKey = typeof key === 'string' ? key : u8aToHex(key)
  const value = await api.rpc.state.getStorage(storageKey, hash)
  const proof = await api.rpc.state.getReadProof([storageKey], hash)
  const valueHex = value.isSome ? value.unwrap().toHex() : null
  const revision = valueHex ? BigInt('0x' + valueHex.slice(2 + 2 * 312, 2 + 2 * 320)).toString() : null
  const chainId = valueHex ? BigInt('0x' + valueHex.slice(2 + 2 * 32, 2 + 2 * 64)).toString() : null

  const capture = {
    label,
    titleId,
    chainId,
    revision,
    header: {
      number: header.number.toNumber(),
      hash,
      parentHash: header.parentHash.toHex(),
      stateRoot: header.stateRoot.toHex(),
      extrinsicsRoot: header.extrinsicsRoot.toHex(),
      encoded: encodedHeader,
    },
    finalizedHeadAtCapture: { hash: finalizedHead.toHex(), number: finalizedNumber },
    justification: {
      encoded: j.encoded,
      source: j.source,
      round: j.decoded.round,
      setId,
      targetHash: j.decoded.targetHash,
      targetNumber: j.decoded.targetNumber,
      precommits: j.decoded.precommits,
    },
    authorities: authorityList,
    storageKey,
    value: valueHex,
    valueBytes: valueHex ? (valueHex.length - 2) / 2 : 0,
    proofNodes: proof.proof.map((n) => n.toHex()),
  }
  log('captured', label, 'at #' + capture.header.number, 'root', capture.header.stateRoot, 'revision', revision)
  return capture
}

// ------------------------------------------------------------------- main

async function main() {
  await cryptoWaitReady()
  api = await ApiPromise.create({ provider: new WsProvider(WS) })

  const keyring = new Keyring({ type: 'sr25519' })
  const alice = keyring.addFromUri('//Alice')
  const bob = keyring.addFromUri('//Bob')
  const aliceEd = new Keyring({ type: 'ed25519' }).addFromUri('//Alice')

  const chain = (await api.rpc.system.chain()).toString()
  const genesis = (await api.rpc.chain.getBlockHash(0)).toHex()
  const runtime = (await api.rpc.state.getRuntimeVersion()).toHuman()
  const evmChainId = Number(BigInt((await rpc('eth_chainId')).result))
  const deployerNonce = Number(BigInt((await rpc('eth_getTransactionCount', [DEPLOYER, 'latest'])).result))

  // Deploy order is fixed, so the gate address is known before the native
  // record names it: hasher, verifier, feed, gate, guard.
  const predictedGate = cast('compute-address', '--nonce', String(deployerNonce + 3), DEPLOYER).split(' ').pop()
  log('predicted gate', predictedGate, 'evm chain', evmChainId)

  // ---- native: create, bind, mark live
  const salt = u8aToHex(randomBytes(32))
  const titleId = u8aToHex(blake2AsU8a(u8aConcat(decodeAddress(alice.address), hexToU8a(salt)), 256))
  const fill = (b) => u8aToHex(new Uint8Array(32).fill(b))
  const fields = {
    chainId: evmChainId,
    nativeAsset: fill(0xab),
    backing: fill(0xcd),
    identityHash: fill(0x11),
    vestingHash: fill(0x22),
    permissionsHash: fill(0x33),
    evmBeneficiary: BENEFICIARY,
  }
  const reservedBefore = (await api.query.system.account(alice.address)).data.reserved.toString()

  const create = await submit(
    'create_title',
    api.tx.lemoTitle.createTitle(salt, fields.chainId, fields.nativeAsset, fields.backing, fields.identityHash, fields.vestingHash, fields.permissionsHash, fields.evmBeneficiary),
    alice,
  )
  const created = create.events.find((e) => e.name === 'lemoTitle.TitleCreated')
  if (!created || created.data.titleId !== titleId) throw new Error('TitleCreated id does not match the derived id')
  const reservedAfterCreate = (await api.query.system.account(alice.address)).data.reserved.toString()

  await submit('set_representation', api.tx.lemoTitle.setRepresentation(titleId, predictedGate), alice)
  await submit('sudo set_representation_live(true)', api.tx.sudo.sudo(api.tx.lemoTitle.setRepresentationLive(titleId, true)), alice)
  const proofA = await captureAt('proof A (mint and transfer)', nativeSteps.at(-1).blockNumber, titleId)
  if (proofA.revision !== '2') throw new Error('expected revision 2 at proof A')

  // ---- EVM: deploy and attest root A
  const hasher = await deploy('deploy TestBlake2b', artifact('TestBlake2b.sol', 'TestBlake2b'))
  const verifier = await deploy('deploy SubstrateTrieVerifier', artifact('SubstrateTrieVerifier.sol', 'SubstrateTrieVerifier'), 'constructor(address)', hasher)
  const feed = await deploy('deploy RootFeed', artifact('RootFeed.sol', 'RootFeed'), 'constructor(address)', DEPLOYER)

  // The commitment is computed by the verifier's own code from the proven bytes.
  const w = (i) => '0x' + proofA.value.slice(2 + 64 * i, 2 + 64 * (i + 1))
  const addr = (i) => '0x' + w(i).slice(26)
  const recordTuple = `(${w(0)},${BigInt(w(1))},${w(2)},${w(3)},${addr(4)},${w(5)},${w(6)},${w(7)},${addr(8)},${BigInt(w(9))})`
  const commitment = call(verifier, 'commitmentOf((bytes32,uint256,bytes32,bytes32,address,bytes32,bytes32,bytes32,address,uint64))(bytes32)', recordTuple)
  const gateArt = artifact('TitleGateERC20.sol', 'TitleGateERC20')
  const gate = await deploy(
    'deploy TitleGateERC20',
    gateArt,
    'constructor(address,address,bytes32,bytes32,address,string,string,uint256)',
    verifier, feed, titleId, commitment, DEPLOYER, 'LEMO Local Title', 'LEMO-L', MAX_SUPPLY.toString(),
  )
  if (gate.toLowerCase() !== predictedGate.toLowerCase()) throw new Error(`gate landed at ${gate}, predicted ${predictedGate}`)
  const guard = await deploy('deploy UnbondGuard', artifact('UnbondGuard.sol', 'UnbondGuard'), 'constructor(address,address,address,bytes32,address)', verifier, feed, gate, titleId, DEPLOYER)

  const snapshot = (label) => {
    const s = {
      after: label,
      totalSupply: call(gate, 'totalSupply()(uint256)'),
      beneficiary: call(gate, 'balanceOf(address)(uint256)', BENEFICIARY),
      bob: call(gate, 'balanceOf(address)(uint256)', BOB_EVM),
      representationOutstanding: call(gate, 'representationOutstanding()(bool)') === 'true',
      acceptedRevision: call(gate, 'acceptedRevision()(uint64)'),
      feedRoot: call(feed, 'currentRoot()(bytes32)'),
      feedBlock: call(feed, 'currentBlockNumber()(uint256)'),
    }
    evmState.push(s)
    return s
  }
  const evmState = []

  await send('feed.attest(root A)', { from: DEPLOYER, to: feed, data: calldata('attest(bytes32,uint256)', proofA.header.stateRoot, String(proofA.header.number)) })
  snapshot('attest root A')
  await send('gate.mint(full cap to beneficiary)', { from: DEPLOYER, to: gate, data: calldata(`mint(address,uint256,${PROOF_TUPLE})`, BENEFICIARY, MAX_SUPPLY.toString(), proofArg(proofA, gate, OP.mint)) })
  snapshot('mint')
  await send('gate.transfer(beneficiary -> bob)', { from: BENEFICIARY, to: gate, data: calldata(`transfer(address,uint256,${PROOF_TUPLE})`, BOB_EVM, TRANSFER.toString(), proofArg(proofA, gate, OP.transfer)) })
  snapshot('transfer')
  // Same action again: the transfer nullifier is per (revision, action).
  await send('gate.transfer replayed (same action)', { from: BENEFICIARY, to: gate, data: calldata(`transfer(address,uint256,${PROOF_TUPLE})`, BOB_EVM, TRANSFER.toString(), proofArg(proofA, gate, OP.transfer)), expectRevert: true })

  // ---- native: unbond refused while live
  const refused = await submit('request_unbond (while live)', api.tx.lemoTitle.requestUnbond(titleId), alice, { expectFailure: true })
  if (refused.error?.error !== 'RepresentationLive') throw new Error('unexpected refusal ' + JSON.stringify(refused.error))
  // ---- EVM: the guard refuses too while supply exists
  await send('guard.requestUnbond (supply outstanding)', { from: DEPLOYER, to: guard, data: calldata(`requestUnbond(${PROOF_TUPLE})`, proofArg(proofA, gate, OP.burn)), expectRevert: true })

  // ---- fresh finalized root for the exit
  const proofB = await captureAt('proof B (exit)', refused.blockNumber + 1, titleId)
  await send('feed.attest(root B)', { from: DEPLOYER, to: feed, data: calldata('attest(bytes32,uint256)', proofB.header.stateRoot, String(proofB.header.number)) })
  snapshot('attest root B')
  await send('gate.transfer(bob -> beneficiary)', { from: BOB_EVM, to: gate, data: calldata(`transfer(address,uint256,${PROOF_TUPLE})`, BENEFICIARY, TRANSFER.toString(), proofArg(proofB, gate, OP.transfer)) })
  snapshot('transfer back')
  await send('gate.burn(full cap)', { from: BENEFICIARY, to: gate, data: calldata(`burn(address,uint256,${PROOF_TUPLE})`, BENEFICIARY, MAX_SUPPLY.toString(), proofArg(proofB, gate, OP.burn)) })
  const afterBurn = snapshot('burn')
  if (afterBurn.representationOutstanding) throw new Error('supply still outstanding after burn')
  const guardReq = await send('guard.requestUnbond (burn proof)', { from: BENEFICIARY, to: guard, data: calldata(`requestUnbond(${PROOF_TUPLE})`, proofArg(proofB, gate, OP.burn)) })
  const requestId = call(guard, 'openRequest()(bytes32)')
  await send('guard.completeUnbond', { from: DEPLOYER, to: guard, data: calldata('completeUnbond(bytes32)', requestId) })
  const guardState = { requestId, released: call(guard, 'released()(bool)') === 'true', requestTx: guardReq.txHash }

  // ---- native: mirror the burn, then unbond
  await submit('sudo set_representation_live(false)', api.tx.sudo.sudo(api.tx.lemoTitle.setRepresentationLive(titleId, false)), alice)
  const req = await submit('request_unbond', api.tx.lemoTitle.requestUnbond(titleId), alice)
  const due = Number(String(req.events.find((e) => e.name === 'lemoTitle.UnbondRequested').data.at).replace(/,/g, ''))
  await submit('finalize_unbond (before due)', api.tx.lemoTitle.finalizeUnbond(titleId), bob, { expectFailure: true })
  log('waiting for block', due)
  for (;;) {
    const best = (await api.rpc.chain.getHeader()).number.toNumber()
    if (best + 1 >= due) break
    await sleep(1000)
  }
  const fin = await submit('finalize_unbond', api.tx.lemoTitle.finalizeUnbond(titleId), bob)
  const reservedAfterFinalize = (await api.query.system.account(alice.address)).data.reserved.toString()
  const titlesAfter = (await api.query.lemoTitle.titles(titleId)).isSome
  const proofC = await captureAt('proof C (after unbond)', fin.blockNumber, titleId)

  const fixture = {
    kind: 'lemo-local-e2e',
    note: 'Local devnet run. Native half: solochain template node with pallet-lemo-title (no Revive, no EVM). EVM half: anvil. Real transactions on both; no mocks. Development keys only.',
    capturedAt: new Date().toISOString(),
    native: {
      endpoint: WS,
      chain,
      genesis,
      runtime,
      devAuthority: { name: '//Alice ed25519 (GRANDPA dev key)', publicKey: u8aToHex(aliceEd.publicKey) },
      accounts: { alice: alice.address, bob: bob.address },
      salt,
      titleId,
      titleIdDerivation: 'blake2_256(alice_pubkey ++ salt)',
      fields,
      deposit: { reservedBefore, reservedAfterCreate, reservedAfterFinalize },
      titleExistsAfterFinalize: titlesAfter,
      unbondDueBlock: due,
      steps: nativeSteps,
    },
    proofs: { A: proofA, B: proofB, C: proofC },
    evm: {
      endpoint: ANVIL,
      chainId: evmChainId,
      accounts: { deployer: DEPLOYER, beneficiary: BENEFICIARY, bob: BOB_EVM },
      contracts: { hasher, verifier, feed, gate, guard },
      predictedGate,
      titleCommitment: commitment,
      maxSupply: MAX_SUPPLY.toString(),
      transferAmount: TRANSFER.toString(),
      steps: evmSteps,
      state: evmState,
      guard: guardState,
    },
  }
  writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`)
  log('wrote', OUT)
  await api.disconnect()
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
