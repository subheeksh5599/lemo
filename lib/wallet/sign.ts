/**
 * Sign with the visitor's own Portaldot wallet.
 *
 * The extension (Talisman, SubWallet, Polkadot.js) signs native extrinsics:
 * `nfts.*` for the native title and `revive.call` for the EVM contracts.
 * Signed extrinsics are indexed by the Portaldot V3 scanner, so every result
 * links straight to `extrinsics/<block>-<index>`. An account Revive has not
 * mapped yet gets `revive.mapAccount` batched in front of its first EVM call.
 *
 * The key never leaves the extension; this module only receives a signer.
 */

import type { ApiPromise } from '@polkadot/api'
import type { SubmittableExtrinsic } from '@polkadot/api/types'
import { decodeAddress, keccakAsU8a } from '@polkadot/util-crypto'
import { u8aToHex } from '@polkadot/util'

import { listSubstrateWallets, type SubstrateAccount } from './substrate'
import { normalizeSubstrateAccounts } from './validation'

const NODE_WS = 'wss://test-node-v3.portaldot.dev'
/** A Revive-mapped account, used only as the origin of read-only dry runs. */
const DRY_RUN_ORIGIN = '5FJ9YMZwMuqDpmD5Y6xTje2vEN3UcMaMcVs9ptSDqJSkshCz'

export type SignedSubmit = {
  blockNumber: number
  blockHash: string
  index: number
  extrinsicHash: string
  mapped: boolean
  feePlanck: string | null
  calls: number
  /** set when the extrinsic was included but its call failed (e.g. a contract revert) */
  failed?: string
}

export type Signer = { signPayload?: unknown; signRaw?: unknown }
type Enabled = { accounts: { get: () => Promise<unknown> }; signer: Signer }
type Tx = SubmittableExtrinsic<'promise'>

export { listSubstrateWallets }

export async function connectSigner(id: string): Promise<{ accounts: SubstrateAccount[]; signer: Signer }> {
  const entry = (window.injectedWeb3 ?? {})[id] as { enable?: (origin: string) => Promise<Enabled> } | undefined
  if (entry?.enable === undefined) throw new Error(`${id} is not installed in this browser`)
  const enabled = await entry.enable('LEMO')
  const accounts = normalizeSubstrateAccounts(await enabled.accounts.get())
  if (accounts.length === 0) throw new Error('the wallet shared no Portaldot accounts with this page')
  return { accounts, signer: enabled.signer }
}

/** The EVM address Revive maps a native account to. */
export function mappedEvm(address: string): string {
  return u8aToHex(keccakAsU8a(decodeAddress(address)).slice(12))
}

let shared: Promise<ApiPromise> | null = null
/** One shared connection to the Portaldot V3 node. */
export async function nodeApi(): Promise<ApiPromise> {
  if (shared === null) {
    shared = import('@polkadot/api').then(({ ApiPromise, WsProvider }) =>
      ApiPromise.create({ provider: new WsProvider(NODE_WS), noInitWarn: true }),
    )
    shared.catch(() => {
      shared = null
    })
  }
  return shared
}

export async function isMapped(api: ApiPromise, address: string): Promise<boolean> {
  const original = await api.query.revive.originalAccount(mappedEvm(address))
  return !(original as unknown as { isEmpty: boolean }).isEmpty
}

const ERRORS = [
  'TitleFrozen()',
  'AlreadyClaimed()',
  'Insufficient()',
  'StillHeld()',
  'NotClaimed()',
  'BadKey()',
  'MixedTitles()',
  'NotProven(uint8)',
  'NotTheNativeOwner(address)',
  'WrongSetId(uint256,uint256)',
  'BlockNotNewer(uint256,uint256)',
]
const REVERTS: Record<string, string> = Object.fromEntries(
  ERRORS.map((sig) => [u8aToHex(keccakAsU8a(sig).slice(0, 4)), sig.replace(/\(.*$/, '')]),
)

const EXPLAIN: Record<string, string> = {
  TitleFrozen: 'TitleFrozen: the native title is gone, so this LNT cannot move',
  MixedTitles: 'MixedTitles: that address already holds LNT of another title; each holder keeps one title so a freeze stays exact',
  Insufficient: 'Insufficient: not enough LNT',
  AlreadyClaimed: 'AlreadyClaimed: this title was already minted',
  NotTheNativeOwner: 'NotTheNativeOwner: the proven native owner is another account',
  StillHeld: 'StillHeld: the original owner still holds the native title',
}

export function revertName(data: string): string {
  const selector = data.slice(0, 10).toLowerCase()
  const name = REVERTS[selector]
  if (name !== undefined) return EXPLAIN[name] ?? name
  return data.length > 2 ? `error ${selector}` : 'no reason given'
}

export type EvmCall = { dest: string; data: string; storageTpot?: number }
export type Weight = { refTime: bigint; proofSize: bigint }

/**
 * Build `revive.call`s. The first call is dry-run against the chain as it is
 * now: if it would revert, this throws before anything is signed. Calls with
 * no weight given are sized from that dry run, all with a 1.6x margin.
 */
export async function evmCalls(api: ApiPromise, address: string, calls: EvmCall[], weights: (Weight | null)[] = []): Promise<Tx[]> {
  const first = calls[0]
  if (first === undefined) return []
  const mapped = await isMapped(api, address)
  const limit = (call: EvmCall) => BigInt(Math.round((call.storageTpot ?? 2) * 1e14))
  const dry = (await api.call.reviveApi.call(mapped ? address : DRY_RUN_ORIGIN, first.dest, 0, null, limit(first), first.data)) as unknown as {
    weightRequired: { refTime: { toBigInt: () => bigint }; proofSize: { toBigInt: () => bigint } }
    result: {
      isErr: boolean
      asErr: { isModule: boolean; asModule: unknown }
      asOk: { flags: { isRevert: boolean }; data: { toHex: () => string } }
    }
  }
  if (dry.result.isErr) {
    const err = dry.result.asErr
    const meta = err.isModule ? api.registry.findMetaError(err.asModule as never) : null
    if (meta?.name === 'StorageDepositNotEnoughFunds' || meta?.name === 'StorageDepositLimitExhausted') {
      const account = (await api.query.system.account(address)) as unknown as { data: { free: { toBigInt: () => bigint } } }
      const free = Number(account.data.free.toBigInt()) / 1e14
      const need = calls.reduce((n, c) => n + (c.storageTpot ?? 2), 0)
      throw new Error(
        `Not enough tPOT on ${address.slice(0, 6)}…${address.slice(-5)}: it has ${free.toFixed(2)} free, and this step can hold up to ${need} tPOT of storage deposit plus fees. Fund this account (or switch to one with tPOT) and press again.`,
      )
    }
    throw new Error(meta ? `the chain would refuse this: ${meta.section}.${meta.name}` : 'the chain would refuse this call')
  }
  // ReturnFlags is a bitflags codec: bit 0 is REVERT (there is no isRevert getter)
  const flags = (dry as unknown as { toJSON: () => { result?: { ok?: { flags?: { bits?: number } } } } }).toJSON().result?.ok?.flags?.bits ?? 0
  if ((flags & 1) === 1) {
    throw new Error(`the contract would revert: ${revertName(dry.result.asOk.data.toHex())}`)
  }
  const base: Weight = { refTime: dry.weightRequired.refTime.toBigInt(), proofSize: dry.weightRequired.proofSize.toBigInt() }
  const txs: Tx[] = calls.map((call, i) => {
    const w = weights[i] ?? base
    const weight = api.createType('SpWeightsWeightV2Weight', {
      refTime: (w.refTime * 8n) / 5n,
      proofSize: (w.proofSize * 8n) / 5n,
    })
    return api.tx.revive.call(call.dest, 0n, weight, limit(call), call.data)
  })
  return mapped ? txs : [api.tx.revive.mapAccount(), ...txs]
}

/** Sign one extrinsic (a batch when several are given) and wait for its block. */
export async function signAndWatch(
  api: ApiPromise,
  address: string,
  signer: Signer,
  txs: Tx[],
  onStatus: (status: string) => void,
): Promise<SignedSubmit> {
  const first = txs[0]
  if (first === undefined) throw new Error('nothing to sign')
  const tx = txs.length === 1 ? first : api.tx.utility.batchAll(txs)
  onStatus('Approve in your wallet')
  return new Promise<SignedSubmit>((resolve, reject) => {
    let fee: string | null = null
    tx.signAndSend(address, { signer: signer as never }, (result) => {
      const { status, events, dispatchError } = result
      if (status.isBroadcast || status.isReady) onStatus('Broadcast, waiting for a block')
      let failed: string | undefined
      if (dispatchError) {
        failed = dispatchError.isModule
          ? (() => {
              const meta = api.registry.findMetaError(dispatchError.asModule)
              return `${meta.section}.${meta.name}`
            })()
          : dispatchError.toString()
      }
      for (const { event } of events) {
        if (event.section === 'transactionPayment' && event.method === 'TransactionFeePaid') {
          fee = event.data[1]?.toString() ?? null
        }
        if (event.section === 'utility' && event.method === 'BatchInterrupted') failed = 'the batch was interrupted on-chain'
      }
      if (status.isInvalid || status.isDropped || status.isUsurped) {
        reject(new Error(`the node did not include the transaction (${status.type})`))
        return
      }
      if (status.isInBlock) {
        const blockHash = status.asInBlock.toHex()
        const index = (result as unknown as { txIndex?: number }).txIndex ?? -1
        void api.rpc.chain.getHeader(blockHash).then((header) =>
          resolve({
            blockNumber: header.number.toNumber(),
            blockHash,
            index,
            extrinsicHash: tx.hash.toHex(),
            mapped: true,
            feePlanck: fee,
            calls: txs.length,
            failed,
          }),
        )
      }
    }).catch((error: unknown) => reject(error instanceof Error ? error : new Error(String(error))))
  })
}

/** Send each calldata to `feed` as native revive.calls in one extrinsic signed by `address`. */
export async function submitSigned(
  address: string,
  signer: Signer,
  feed: string,
  calldatas: string[],
  onStatus: (status: string) => void,
): Promise<SignedSubmit> {
  onStatus('Connecting to Portaldot')
  const api = await nodeApi()
  const mapped = await isMapped(api, address)
  onStatus('Dry-running against the feed')
  const txs = await evmCalls(api, address, calldatas.map((data) => ({ dest: feed, data })))
  const result = await signAndWatch(api, address, signer, txs, onStatus)
  return { ...result, mapped, calls: calldatas.length }
}
