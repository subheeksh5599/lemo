/**
 * Sign a BeefyRootFeed submission with the visitor's own Portaldot wallet.
 *
 * The extension (Talisman, SubWallet, Polkadot.js) signs a native
 * `revive.call` extrinsic to the feed. Signed extrinsics are indexed by the
 * Portaldot V3 scanner, so the result links straight to `extrinsics/<block>-<index>`.
 * An account Revive has not mapped yet gets `revive.mapAccount` batched in front.
 *
 * The key never leaves the extension; this module only receives a signer.
 */

import { decodeAddress, keccakAsU8a } from '@polkadot/util-crypto'
import { u8aToHex } from '@polkadot/util'

import { listSubstrateWallets, type SubstrateAccount } from './substrate'
import { normalizeSubstrateAccounts } from './validation'

const NODE_WS = 'wss://test-node-v3.portaldot.dev'
/** A Revive-mapped account, used only as the origin of the read-only dry run. */
const DRY_RUN_ORIGIN = '5FJ9YMZwMuqDpmD5Y6xTje2vEN3UcMaMcVs9ptSDqJSkshCz'

export type SignedSubmit = {
  blockNumber: number
  blockHash: string
  index: number
  extrinsicHash: string
  mapped: boolean
  feePlanck: string | null
  calls: number
}

type Signer = { signPayload?: unknown; signRaw?: unknown }
type Enabled = { accounts: { get: () => Promise<unknown> }; signer: Signer }

export { listSubstrateWallets }

export async function connectSigner(id: string): Promise<{ accounts: SubstrateAccount[]; signer: Signer }> {
  const entry = (window.injectedWeb3 ?? {})[id] as { enable?: (origin: string) => Promise<Enabled> } | undefined
  if (entry?.enable === undefined) throw new Error(`${id} is not installed in this browser`)
  const enabled = await entry.enable('LEMO')
  const accounts = normalizeSubstrateAccounts(await enabled.accounts.get())
  if (accounts.length === 0) throw new Error('the wallet shared no Portaldot accounts with this page')
  return { accounts, signer: enabled.signer }
}

/** Send each calldata to `feed` as native revive.calls in one extrinsic signed by `address`. */
export async function submitSigned(
  address: string,
  signer: Signer,
  feed: string,
  calldatas: string[],
  onStatus: (status: string) => void,
): Promise<SignedSubmit> {
  const { ApiPromise, WsProvider } = await import('@polkadot/api')
  onStatus('Connecting to Portaldot')
  const api = await ApiPromise.create({ provider: new WsProvider(NODE_WS), noInitWarn: true })
  try {
    const h160 = u8aToHex(keccakAsU8a(decodeAddress(address)).slice(12))
    const original = await api.query.revive.originalAccount(h160)
    const mapped = !(original as unknown as { isEmpty: boolean }).isEmpty

    const storageLimit = 2n * 10n ** 14n // a cap, charged only for bytes actually written

    // Dry-run the first call against the feed as it is now, so a submission the
    // feed would refuse is never signed, and size every call's weight from it.
    // The origin only needs to be mapped: submit() is permissionless.
    onStatus('Dry-running against the feed')
    const dry = (await api.call.reviveApi.call(mapped ? address : DRY_RUN_ORIGIN, feed, 0, null, null, calldatas[0])) as unknown as {
      weightRequired: { refTime: { toBigInt: () => bigint }; proofSize: { toBigInt: () => bigint } }
      result: { isErr: boolean; asOk: { flags: { isRevert: boolean } } }
    }
    if (dry.result.isErr || dry.result.asOk.flags.isRevert) {
      throw new Error('the feed would refuse this submission (it may have just been advanced); try again')
    }
    const weight = api.createType('SpWeightsWeightV2Weight', {
      refTime: (dry.weightRequired.refTime.toBigInt() * 8n) / 5n,
      proofSize: (dry.weightRequired.proofSize.toBigInt() * 8n) / 5n,
    })
    const calls = calldatas.map((data) => api.tx.revive.call(feed, 0n, weight, storageLimit, data))
    const all = mapped ? calls : [api.tx.revive.mapAccount(), ...calls]
    const tx = all.length === 1 ? all[0]! : api.tx.utility.batchAll(all)

    onStatus('Approve in your wallet')
    return await new Promise<SignedSubmit>((resolve, reject) => {
      let fee: string | null = null
      tx.signAndSend(address, { signer: signer as never }, (result) => {
        const { status, events, dispatchError } = result
        if (status.isBroadcast || status.isReady) onStatus('Broadcast, waiting for a block')
        if (dispatchError) {
          if (dispatchError.isModule) {
            const meta = api.registry.findMetaError(dispatchError.asModule)
            reject(new Error(`${meta.section}.${meta.name}`))
          } else reject(new Error(dispatchError.toString()))
          return
        }
        for (const { event } of events) {
          if (event.section === 'transactionPayment' && event.method === 'TransactionFeePaid') {
            fee = event.data[1]?.toString() ?? null
          }
          if (event.section === 'utility' && event.method === 'BatchInterrupted') {
            reject(new Error('the batch was interrupted on-chain'))
            return
          }
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
              mapped,
              feePlanck: fee,
              calls: calldatas.length,
            }),
          )
        }
      }).catch((error: unknown) => reject(error instanceof Error ? error : new Error(String(error))))
    })
  } finally {
    setTimeout(() => void api.disconnect(), 1000)
  }
}
