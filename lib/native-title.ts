/**
 * The native title on public Portaldot V3, and its EVM representation.
 *
 * Native: an item of the `nfts` pallet. Its `Nfts::Item(collection, item)`
 * entry starts with the owner's AccountId32.
 * EVM: NativeTitleToken, which proves that entry against BeefyRootFeed's
 * validator-signed root before it mints, and freezes when a newer proof shows
 * the item burned or sold natively.
 */

import { blake2AsU8a, keccakAsU8a, xxhashAsU8a } from '@polkadot/util-crypto'
import { bnToU8a } from '@polkadot/util'

import { BEEFY_FEED, bytesToHex, hexToBytes } from '@/lib/beefy'
import { EVM_RPC, NATIVE_RPC, rpc } from '@/lib/chain'
import { concat, encBytes, encBytesArray, encodeArgs, selector, word, type RelayPlan } from '@/lib/live-proof'

export const TOKEN: string | null = (() => {
  const raw = (process.env.NEXT_PUBLIC_LEMO_TITLE_TOKEN ?? '').trim()
  return /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw : null
})()

export { BEEFY_FEED }

/** Measured on Portaldot V3 by ReviveApi_call (claim of collection 12, item 0). */
export const CLAIM_WEIGHT = { refTime: 6_804_706_992n, proofSize: 176_263n }
/** The claim's first-write storage deposit was 26.89 tPOT; this is the cap. */
export const CLAIM_STORAGE_TPOT = 32
export const UNITS = 1000n * 10n ** 18n

const le32 = (n: number) => bnToU8a(n, { bitLength: 32, isLe: true })

export function itemKey(collection: number, item: number): string {
  return bytesToHex(
    concat(
      xxhashAsU8a('Nfts', 128),
      xxhashAsU8a('Item', 128),
      blake2AsU8a(le32(collection), 128),
      le32(collection),
      blake2AsU8a(le32(item), 128),
      le32(item),
    ),
  )
}

/** keccak256(abi.encodePacked(uint32 collection, uint32 item)), as the token keys titles. */
export function titleId(collection: number, item: number): string {
  const packed = new Uint8Array(8)
  new DataView(packed.buffer).setUint32(0, collection)
  new DataView(packed.buffer).setUint32(4, item)
  return bytesToHex(keccakAsU8a(packed))
}

/* ---- calldata ------------------------------------------------------------- */

function keyAndNodes(sig: string, key: string, nodes: string[]): string {
  return bytesToHex(
    concat(
      selector(sig),
      encodeArgs([
        { dynamic: true, data: encBytes(hexToBytes(key)) },
        { dynamic: true, data: encBytesArray(nodes.map(hexToBytes)) },
      ]),
    ),
  )
}

export const encodeClaim = (key: string, nodes: string[]) => keyAndNodes('claim(bytes,bytes[])', key, nodes)
export const encodeFreeze = (key: string, nodes: string[]) => keyAndNodes('freeze(bytes,bytes[])', key, nodes)

export function encodeTransfer(to: string, amount: bigint): string {
  return bytesToHex(concat(selector('transfer(address,uint256)'), word(BigInt(to)), word(amount)))
}

export function encodeBurn(amount: bigint): string {
  return bytesToHex(concat(selector('burn(uint256)'), word(amount)))
}

/* ---- reads ---------------------------------------------------------------- */

async function call(data: Uint8Array): Promise<string> {
  if (TOKEN === null) throw new Error('NEXT_PUBLIC_LEMO_TITLE_TOKEN is not set in this build')
  return rpc<string>(EVM_RPC, 'eth_call', [{ to: TOKEN, data: bytesToHex(data) }, 'latest'])
}

const words = (hex: string) => {
  const out: bigint[] = []
  for (let i = 2; i + 64 <= hex.length; i += 64) out.push(BigInt(`0x${hex.slice(i, i + 64)}`))
  return out
}

export type TitleState = {
  claimed: boolean
  frozen: boolean
  outstanding: bigint
  claimedAt: number
  owner: string
}

export type TokenReading = {
  totalSupply: bigint
  balance: bigint | null
  /** the title id the holder's balance belongs to (one title per holder) */
  heldTitle: string | null
  title: TitleState | null
}

export async function readToken(holder: string | null, collection: number | null, item: number | null): Promise<TokenReading> {
  const [supply, balance, held, title] = await Promise.all([
    call(selector('totalSupply()')),
    holder === null ? Promise.resolve(null) : call(concat(selector('balanceOf(address)'), word(BigInt(holder)))),
    holder === null ? Promise.resolve(null) : call(concat(selector('titleOf(address)'), word(BigInt(holder)))),
    collection === null || item === null
      ? Promise.resolve(null)
      : call(concat(selector('titles(bytes32)'), hexToBytes(titleId(collection, item)))),
  ])
  let state: TitleState | null = null
  if (title !== null) {
    const [owner, outstanding, claimedAt, claimed, frozen] = words(title)
    state = {
      owner: `0x${(owner ?? 0n).toString(16).padStart(64, '0')}`,
      outstanding: outstanding ?? 0n,
      claimedAt: Number(claimedAt ?? 0n),
      claimed: (claimed ?? 0n) !== 0n,
      frozen: (frozen ?? 0n) !== 0n,
    }
  }
  return {
    totalSupply: words(supply)[0] ?? 0n,
    balance: balance === null ? null : (words(balance)[0] ?? 0n),
    heldTitle: held === null ? null : held.slice(0, 66),
    title: state,
  }
}

export async function readFeedBlock(): Promise<number> {
  if (BEEFY_FEED === null) throw new Error('NEXT_PUBLIC_LEMO_BEEFY_FEED is not set')
  const result = await rpc<string>(EVM_RPC, 'eth_call', [{ to: BEEFY_FEED, data: bytesToHex(selector('currentBlockNumber()')) }, 'latest'])
  return Number(BigInt(result))
}

/** The read proof of a title's native entry at a block, and the owner it shows. */
export async function itemProof(
  collection: number,
  item: number,
  block: number,
): Promise<{ key: string; nodes: string[]; owner: string | null }> {
  const key = itemKey(collection, item)
  const hash = await rpc<string>(NATIVE_RPC, 'chain_getBlockHash', [block])
  const [proof, value] = await Promise.all([
    rpc<{ proof: string[] }>(NATIVE_RPC, 'state_getReadProof', [[key], hash]),
    rpc<string | null>(NATIVE_RPC, 'state_getStorage', [key, hash]),
  ])
  return { key, nodes: proof.proof, owner: value === null ? null : value.slice(0, 66) }
}

/** The root block the feed will hold after the plan's steps run. */
export function targetBlock(plan: RelayPlan): number {
  const last = plan.steps[plan.steps.length - 1]
  return last === undefined ? plan.feed.block : last.block
}
