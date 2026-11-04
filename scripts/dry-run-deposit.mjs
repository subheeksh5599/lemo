import fs from 'node:fs'
import { ApiPromise, WsProvider } from '../node_modules/@polkadot/api/index.js'
import { secp256k1Expand, keccakAsU8a } from '../node_modules/@polkadot/util-crypto/index.js'
import { u8aToHex } from '../node_modules/@polkadot/util/index.js'
import { execSync } from 'node:child_process'
const api=await ApiPromise.create({provider:new WsProvider('wss://test-node-v3.portaldot.dev'),noInitWarn:true})
const setId=(await api.query.beefy.validatorSetId()).toString()
const auths=(await api.query.beefy.authorities()).map(a=>u8aToHex(keccakAsU8a(secp256k1Expand(a.toU8a())).slice(12)))
const name=process.argv[2]||'BeefyRootFeed'
const art=JSON.parse(fs.readFileSync(`out/${name}.sol/${name}.json`))
const args=process.env.ARGS||execSync(`$HOME/.foundry/bin/cast abi-encode "c(uint64,address[],address)" ${setId} "[${auths.join(",")}]" 0x15ae34fa8fd933d6d4e1cf9a772b305f0abc7e22`).toString().trim()
const code=art.bytecode.object+args.slice(2)
const origin=process.env.ORIGIN||'5FJ9YMZwMuqDpmD5Y6xTje2vEN3UcMaMcVs9ptSDqJSkshCz'
const r=await api.call.reviveApi.instantiate(origin,0,null,null,{Upload:code},'0x',null)
const j=r.toJSON(); console.log('setId',setId,auths, 'bytes',(code.length-2)/2)
console.log(JSON.stringify({storageDeposit:j.storageDeposit,gasConsumed:j.gasConsumed,result:JSON.stringify(j.result).slice(0,200)}))
const sd=j.storageDeposit; const v=BigInt(sd.charge??sd.Charge??0); console.log('deposit tPOT', Number(v)/1e14)
const m=api.registry.findMetaError({index:api.createType("u8",80),error:api.createType("[u8;4]","0x17000000")});console.log(m.section,m.name,m.docs.join(" "));process.exit(0)
