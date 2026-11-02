#!/usr/bin/env node
// Deploy one EVM contract through the native Revive pallet.
//
//   PORTALDOT_MNEMONIC=... node scripts/native-deploy.mjs <ArtifactName> [constructorArgsHex]
//
// The mnemonic is read from the environment and never written or printed. The
// signer is the sr25519 account derived from it, so the fee and storage deposit
// come from the native tPOT balance, not from the EVM address balance.

import fs from 'node:fs'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { Keyring } from '@polkadot/keyring'
import { cryptoWaitReady } from '@polkadot/util-crypto'

const name = process.argv[2]
const ctorArgs = (process.argv[3] ?? '0x').replace(/^0x/, '')
if (!name) {
  console.error('usage: PORTALDOT_MNEMONIC=... node scripts/native-deploy.mjs <ArtifactName> [ctorArgsHex]')
  process.exit(1)
}

const mnemonic = process.env.PORTALDOT_MNEMONIC
if (!mnemonic) {
  console.error('PORTALDOT_MNEMONIC is required')
  process.exit(1)
}

const artifactPath = fs
  .readdirSync('out', { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${name}.sol`))
  .map((entry) => `out/${entry.name}/${name}.json`)
  .find((path) => fs.existsSync(path))
if (!artifactPath) {
  console.error(`artifact not found for ${name}`)
  process.exit(1)
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
const code = artifact.bytecode.object
const initCode = `${code}${ctorArgs}`
const codeBytes = (initCode.length - 2) / 2
const data = '0x'

await cryptoWaitReady()
const keyring = new Keyring({ type: 'sr25519', ss58Format: 42 })
const signer = keyring.addFromUri(mnemonic)
console.log('signer', signer.address)
console.log('artifact', artifactPath, `${codeBytes} bytes`)

const api = await ApiPromise.create({
  provider: new WsProvider('wss://test-node-v3.portaldot.dev'),
  noInitWarn: true,
})
console.log('chain', (await api.rpc.system.chain()).toString())

// The weight limit is a ceiling, not a charge. The storage limit is the maximum
// the pallet may reserve; the actual deposit is measured from the code and state.
const weight = api.createType('SpWeightsWeightV2Weight', {
  refTime: '1500000000000',
  proofSize: '1000000000000000000',
})
const storageLimitTpot = BigInt(process.env.STORAGE_LIMIT_TPOT ?? '500')
const storageLimit = limitTpotToBase(storageLimitTpot)
function limitTpotToBase(tpot) {
  return tpot * 10n ** 14n
}

const tx = api.tx.revive.instantiateWithCode(0n, weight, storageLimit, initCode, data, null)
console.log('tx', tx.method.toHuman())

let done
const result = new Promise((resolve, reject) => {
  done = { resolve, reject }
})

const unsub = await tx.signAndSend(signer, ({ status, events, dispatchError }) => {
  if (dispatchError) {
    if (dispatchError.isModule) {
      const decoded = api.registry.findMetaError(dispatchError.asModule)
      done.reject(new Error(`${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`))
    } else {
      done.reject(new Error(dispatchError.toString()))
    }
    return
  }
  if (status.isInBlock) {
    console.log('in block', status.asInBlock.toHex())
    for (const { event } of events) {
      if (event.section === 'revive' && event.method === 'Instantiated') {
        console.log('instantiated', event.toHuman())
      }
    }
  }
  if (status.isFinalized) {
    console.log('finalized', status.asFinalized.toHex())
    done.resolve()
  }
})

try {
  await result
} catch (error) {
  console.error('deploy failed:', error.message)
  process.exitCode = 1
} finally {
  await unsub()
  await api.disconnect()
}
