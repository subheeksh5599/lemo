#!/usr/bin/env node
// Compare every deployed contract's creation code with a build of this repo.
// Keyless: reads the deploy extrinsics from Portaldot V3.
//   forge build && node scripts/check-deployments.mjs                 # against main
//   git worktree add /tmp/lemo-165fe5f 165fe5f && (cd /tmp/lemo-165fe5f && forge build --skip test)
//   OUT=/tmp/lemo-165fe5f/out node scripts/check-deployments.mjs       # against the commit the first four came from
import { ApiPromise, WsProvider } from '@polkadot/api'
import fs from 'node:fs'

const OUT = process.env.OUT ?? 'out'
const DEPLOYS = {
  '294148-1': 'ReviveBlake2b256',
  '294249-1': 'RootFeed',
  '294498-1': 'SubstrateTrieVerifier',
  '294503-1': 'TitleGateERC20',
  '316946-1': 'BeefyRootFeed',
  '319127-1': 'NativeTitleToken',
}

const api = await ApiPromise.create({ provider: new WsProvider('wss://test-node-v3.portaldot.dev'), noInitWarn: true })
for (const [id, name] of Object.entries(DEPLOYS)) {
  const [block, index] = id.split('-').map(Number)
  const x = (await api.rpc.chain.getBlock(await api.rpc.chain.getBlockHash(block))).block.extrinsics[index]
  const code = x.method.args.find((_, k) => x.method.meta.args[k].name.toString() === 'code').toHex().slice(2)
  let built
  try {
    built = JSON.parse(fs.readFileSync(`${OUT}/${name}.sol/${name}.json`)).bytecode.object.replace(/^0x/, '')
  } catch {
    console.log(`${id}  ${name.padEnd(22)} no artifact in ${OUT}`)
    continue
  }
  const verdict = code.startsWith(built)
    ? `matches, plus ${(code.length - built.length) / 2} bytes of constructor arguments`
    : `differs (deployed ${code.length / 2} bytes, built ${built.length / 2})`
  console.log(`${id}  ${name.padEnd(22)} ${verdict}`)
}
await api.disconnect()
