/**
 * EVM wallet discovery over EIP-6963.
 *
 * Wallets announce themselves with `eip6963:announceProvider` in response to
 * `eip6963:requestProvider`. Nothing is read from `window.ethereum`: that field
 * is a single-winner race, and this console lists every installed provider.
 *
 * Read-only. The only calls made here are `eth_requestAccounts` on an explicit
 * connect, plus `eth_accounts` and `eth_chainId` for state. No signing, no
 * transactions, and no keys ever leave the extension.
 */

import {
  isEvmAddress,
  mergeAnnouncement,
  parseEip6963Announcement,
  type AnnouncedWallet,
  type Eip1193Provider,
} from './validation'

export const EIP6963_ANNOUNCE = 'eip6963:announceProvider'
export const EIP6963_REQUEST = 'eip6963:requestProvider'

export type { Eip1193Provider } from './validation'

/** A parsed announcement; `verified` and `icon` are already sanitised. */
export type EvmWallet = AnnouncedWallet

export type EvmConnection = {
  address: string
  chainId: number | null
}

type EvmEventHandlers = {
  onAccounts?: (accounts: string[]) => void
  onChain?: (chainId: number) => void
  onDisconnect?: () => void
}

function normalizeAccounts(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(isEvmAddress)
}

/** Accepts the hex string wallets return, and the number some test shims send. */
export function toChainId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  }

  if (typeof value === 'bigint') {
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = value.startsWith('0x') ? Number.parseInt(value, 16) : Number(value)
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
  }

  return null
}

/** A chain is named only by the id the wallet reports. Nothing is assumed. */
export function chainLabel(chainId: number | null): string {
  return chainId === null ? 'Chain unavailable' : `Chain ${chainId}`
}

function sortByName(wallets: EvmWallet[]): EvmWallet[] {
  return [...wallets].sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Watch the browser for announced EVM wallets. Returns an unsubscribe function.
 *
 * A second request is sent shortly after the first because some extensions
 * inject their provider after the document has already hydrated. Repeated
 * announcements from the same wallet are deduped by `rdns`/`uuid`; a different
 * provider re-using a claimed id is kept out and the entry marked unverified.
 */
export function subscribeEvmWallets(
  listener: (wallets: EvmWallet[]) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}

  const found = new Map<string, EvmWallet>()
  let closed = false
  let flushScheduled = false

  const flush = () => {
    if (closed || flushScheduled) return
    flushScheduled = true

    queueMicrotask(() => {
      flushScheduled = false
      if (closed) return
      listener(sortByName([...found.values()]))
    })
  }

  const announce = (event: Event) => {
    const wallet = parseEip6963Announcement((event as CustomEvent<unknown>).detail)
    if (wallet === null) return

    // First claimant keeps the id; a second provider claiming it demotes the
    // entry to unverified instead of silently replacing it.
    const merged = mergeAnnouncement(found.get(wallet.id), wallet)
    found.set(wallet.id, merged.wallet)
    if (merged.changed) flush()
  }

  window.addEventListener(EIP6963_ANNOUNCE, announce)

  const request = () => {
    window.dispatchEvent(new Event(EIP6963_REQUEST))
  }

  request()
  const lateRequest = window.setTimeout(request, 400)

  return () => {
    closed = true
    window.clearTimeout(lateRequest)
    window.removeEventListener(EIP6963_ANNOUNCE, announce)
  }
}

/** Ask the wallet for access. This is the only call that can prompt the user. */
export async function connectEvmWallet(wallet: EvmWallet): Promise<EvmConnection> {
  const requested = await wallet.provider.request({ method: 'eth_requestAccounts' })
  const accounts = normalizeAccounts(requested)
  const address = accounts[0]

  if (address === undefined) {
    throw new Error(`${wallet.name} returned no account.`)
  }

  return { address, chainId: await readEvmChainId(wallet.provider) }
}

/** Silent read of accounts the user has already authorized. Never prompts. */
export async function readEvmAccounts(provider: Eip1193Provider): Promise<string[]> {
  try {
    return normalizeAccounts(await provider.request({ method: 'eth_accounts' }))
  } catch {
    return []
  }
}

export async function readEvmChainId(provider: Eip1193Provider): Promise<number | null> {
  try {
    return toChainId(await provider.request({ method: 'eth_chainId' }))
  } catch {
    return null
  }
}

/** Account and chain changes. Returns an unsubscribe function. */
export function subscribeEvmProvider(
  provider: Eip1193Provider,
  handlers: EvmEventHandlers,
): () => void {
  const onAccounts = (payload: unknown) => {
    handlers.onAccounts?.(normalizeAccounts(payload))
  }

  const onChain = (payload: unknown) => {
    const chainId = toChainId(payload)
    if (chainId !== null) handlers.onChain?.(chainId)
  }

  const onDisconnect = () => {
    handlers.onDisconnect?.()
  }

  provider.on?.('accountsChanged', onAccounts)
  provider.on?.('chainChanged', onChain)
  provider.on?.('disconnect', onDisconnect)

  return () => {
    provider.removeListener?.('accountsChanged', onAccounts)
    provider.removeListener?.('chainChanged', onChain)
    provider.removeListener?.('disconnect', onDisconnect)
  }
}
