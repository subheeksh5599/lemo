/**
 * Capture one LEMO native title and its storage proof from a local dev node.
 *
 * This script is for a local runtime only. It uses the standard `//Alice`
 * development key, which is public and must never be used on a live network.
 * The output is a fixture: block header, state root, storage key, SCALE value,
 * proof nodes and the decoded record. It contains no private key material.
 *
 * Usage:
 *   node scripts/local-capture.mjs [ws://127.0.0.1:9944] [out.json]
 */

import { ApiPromise, WsProvider } from '@polkadot/api'
import { Keyring } from '@polkadot/keyring'
import { blake2AsU8a, cryptoWaitReady, decodeAddress } from '@polkadot/util-crypto'
import { u8aConcat, u8aToHex } from '@polkadot/util'
import { writeFileSync } from 'node:fs'

const endpoint = process.argv[2] ?? 'ws://127.0.0.1:9944'
const outfile = process.argv[3] ?? 'local-capture.json'

// The pallet derives the title id from the caller: blake2_256(SCALE(owner, salt)).
// For an AccountId32 owner and a [u8; 32] salt, SCALE is plain concatenation.
function titleSalt() {
  const raw = new Uint8Array(32)
  raw[0] = 0xee
  return raw
}

function titleIdBytes(ownerAddress, salt) {
  return blake2AsU8a(u8aConcat(decodeAddress(ownerAddress), salt), 256)
}

async function main() {
  await cryptoWaitReady()
  const api = await ApiPromise.create({ provider: new WsProvider(endpoint) })
  const keyring = new Keyring({ type: 'sr25519' })
  const alice = keyring.addFromUri('//Alice')
  const beneficiary =
    process.env.LEMO_EVM_BENEFICIARY ?? u8aToHex(decodeAddress(alice.address).slice(-20))
  const salt = titleSalt()
  const titleId = api.createType('H256', titleIdBytes(alice.address, salt))

  const chain = await api.rpc.system.chain()
  const genesis = await api.rpc.chain.getBlockHash(0)
  const runtime = await api.rpc.state.getRuntimeVersion()

  const existing = await api.query.lemoTitle.titles(titleId)
  if (existing.isSome) {
    console.log('title already exists at', titleId.toHex())
  } else {
    // Reserves `TitleDeposit` (1 UNIT on the dev runtime) from Alice.
    const create = api.tx.lemoTitle.createTitle(
      api.createType('[u8;32]', salt),
      420420777,
      api.createType('H256', new Uint8Array(32).fill(0xab)),
      api.createType('H256', new Uint8Array(32).fill(0xcd)),
      api.createType('H256', new Uint8Array(32).fill(0x11)),
      api.createType('H256', new Uint8Array(32).fill(0x22)),
      api.createType('H256', new Uint8Array(32).fill(0x33)),
      api.createType('[u8;20]', beneficiary),
    )

    await new Promise((resolve, reject) => {
      create.signAndSend(alice, ({ status, dispatchError }) => {
        if (dispatchError) reject(new Error(dispatchError.toString()))
        if (status.isInBlock) resolve(status.asInBlock.toHex())
      }).catch(reject)
    })
    console.log('created title', titleId.toHex())
  }

  // Rule 2: the flag must be explicit before an unbond. Set it true, then false
  // so the fixture shows both the refusal state and the releasable state.
  const evmContract = (process.env.LEMO_EVM_CONTRACT ?? '').trim()
  if (evmContract.length > 0) {
    const call = api.tx.lemoTitle.setRepresentation(
      titleId,
      api.createType('[u8;20]', evmContract),
    )
    await new Promise((resolve, reject) => {
      call.signAndSend(alice, ({ status, dispatchError }) => {
        if (dispatchError) reject(new Error(dispatchError.toString()))
        if (status.isInBlock) resolve(status.asInBlock.toHex())
      }).catch(reject)
    })
    console.log('representation bound to', evmContract)
  }

  for (const live of [true, false]) {
    const call = api.tx.lemoTitle.setRepresentationLive(titleId, live)
    const sudo = api.tx.sudo.sudo(call)
    await new Promise((resolve, reject) => {
      sudo.signAndSend(alice, ({ status, dispatchError }) => {
        if (dispatchError) reject(new Error(dispatchError.toString()))
        if (status.isInBlock) resolve(status.asInBlock.toHex())
      }).catch(reject)
    })
    console.log('representation live =', live)
  }

  // Dev finality lags the in-block callback; wait for a later finalized head
  // so the capture contains the written record, not an absent key.
  await new Promise((resolve) => setTimeout(resolve, 8_000))

  const finalizedHash = await api.rpc.chain.getFinalizedHead()
  const header = await api.rpc.chain.getHeader(finalizedHash)
  const storageKey = api.query.lemoTitle.titles.key(titleId)
  const storageKeyHex = typeof storageKey === 'string' ? storageKey : u8aToHex(storageKey)
  const value = await api.rpc.state.getStorage(storageKeyHex, finalizedHash)
  const proof = await api.rpc.state.getReadProof([storageKeyHex], finalizedHash)

  const canonicalKey = api.query.lemoTitle.canonicalTitles.key(titleId)
  const canonicalKeyHex =
    typeof canonicalKey === 'string' ? canonicalKey : u8aToHex(canonicalKey)
  const canonicalValue = await api.rpc.state.getStorage(canonicalKeyHex, finalizedHash)
  const canonicalProof = await api.rpc.state.getReadProof([canonicalKeyHex], finalizedHash)
  const decoded = await api.query.lemoTitle.titles(titleId)
  const representation = await api.query.lemoTitle.representationLive(titleId)

  const fixture = {
    source: 'local-lemo-runtime',
    endpoint,
    chain: chain.toString(),
    runtime: runtime.toHuman(),
    genesis: genesis.toHex(),
    finalized: {
      number: header.number.toNumber(),
      hash: finalizedHash.toHex(),
      parentHash: header.parentHash.toHex(),
      stateRoot: header.stateRoot.toHex(),
    },
    titleId: titleId.toHex(),
    storageKey: storageKeyHex,
    value: value.toHex(),
    valueBytes: (value.toHex().length - 2) / 2,
    proofNodes: proof.proof.map((node) => node.toHex()),
    canonicalStorageKey: canonicalKeyHex,
    canonicalValue: canonicalValue.toHex(),
    canonicalValueBytes: (canonicalValue.toHex().length - 2) / 2,
    canonicalProofNodes: canonicalProof.proof.map((node) => node.toHex()),
    record: decoded.toHuman(),
    representationLive: representation.toHuman(),
    capturedAt: new Date().toISOString(),
  }

  writeFileSync(outfile, `${JSON.stringify(fixture, null, 2)}\n`)
  console.log('wrote', outfile, 'at finalized block', fixture.finalized.number)
  await api.disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
