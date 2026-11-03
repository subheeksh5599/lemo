/**
 * Validation for data the page receives from browser wallets.
 *
 * Wallet announcements (EIP-6963) and extension account lists are written by
 * whatever script got there first: a real extension, a compromised dependency
 * or an XSS elsewhere. Nothing in them is authenticated, so the console only
 * labels a wallet "verified" when its rdns is on a pinned list, only renders
 * icons that are inline raster/SVG data URIs, and only shows Substrate
 * addresses that pass the SS58 checksum for the generic prefix 42.
 *
 * DOM-free on purpose so it runs under `node --test`.
 */

import { checkAddress } from '@polkadot/util-crypto'

/** Reverse-DNS ids of wallets the console recognises by name. */
export const VERIFIED_RDNS: ReadonlySet<string> = new Set([
  'io.metamask',
  'io.metamask.flask',
  'io.rabby',
  'com.coinbase.wallet',
  'app.subwallet',
  'xyz.talisman',
  'io.talisman',
  'com.brave.wallet',
  'app.phantom',
  'io.zerion.wallet',
  'com.okex.wallet',
  'com.trustwallet.app',
  'io.enkrypt',
])

/** Generic Substrate SS58 prefix; Portaldot V3 testnet uses it. */
export const SS58_PREFIX = 42

/** Data URIs above this length are refused (a wallet logo is a few KiB). */
export const MAX_ICON_LENGTH = 128 * 1024

const ICON_PATTERN = /^data:image\/(?:png|svg\+xml|webp)(?:;[a-z0-9=.+-]+)*,/iu

/**
 * Returns the icon only when it is an inline `data:image/png`, `svg+xml` or
 * `webp` URI. Remote URLs (tracking beacons), `javascript:` and every other
 * scheme or MIME type come back as `null`, so the caller falls back to a glyph.
 */
export function safeWalletIcon(icon: unknown): string | null {
  if (typeof icon !== 'string') return null
  const trimmed = icon.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_ICON_LENGTH) return null
  return ICON_PATTERN.test(trimmed) ? trimmed : null
}

/** True only for an rdns on the pinned allowlist (exact, case-sensitive). */
export function isVerifiedRdns(rdns: unknown): boolean {
  return typeof rdns === 'string' && VERIFIED_RDNS.has(rdns)
}

/**
 * True when `address` is a base58 SS58 string with a valid checksum encoded
 * for `prefix` (default 42). Hex public keys and other prefixes are refused.
 */
export function isValidSs58(address: unknown, prefix: number = SS58_PREFIX): boolean {
  if (typeof address !== 'string' || address.length === 0 || address.length > 64) return false

  try {
    const [valid] = checkAddress(address, prefix)
    return valid
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ EIP-6963 */

/** A 20-byte 0x-prefixed hex address, as `eth_accounts` must return. */
export function isEvmAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/u.test(value)
}

/** The slice of EIP-1193 this console needs. Providers own the rest. */
export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>
  on?: (event: string, listener: (payload: unknown) => void) => void
  removeListener?: (event: string, listener: (payload: unknown) => void) => void
}

export type AnnouncedWallet = {
  /** Stable within a session; `rdns` when the wallet supplies one. */
  id: string
  uuid: string
  /** Display name as announced, trimmed and length-capped. */
  name: string
  /** Allowlisted data URI, or null. Never a remote URL. */
  icon: string | null
  rdns: string
  /**
   * The rdns is on the pinned allowlist and no other provider on the page has
   * claimed it. An announcement cannot be authenticated, so this is a
   * recognition signal, not proof of origin.
   */
  verified: boolean
  provider: Eip1193Provider
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isEip1193Provider(value: unknown): value is Eip1193Provider {
  return isRecord(value) && typeof value.request === 'function'
}

const RDNS_PATTERN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/iu
const MAX_NAME_LENGTH = 64

/** Parse an `eip6963:announceProvider` detail. Returns null when unusable. */
export function parseEip6963Announcement(detail: unknown): AnnouncedWallet | null {
  if (!isRecord(detail)) return null

  const info = detail.info
  const provider = detail.provider

  if (!isRecord(info) || !isEip1193Provider(provider)) return null
  if (typeof info.name !== 'string') return null

  // Strip control characters so a name cannot fake layout or direction.
  // oxlint-disable-next-line no-control-regex -- matching control chars is the point
  const name = info.name.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, '').trim()
  if (name.length === 0) return null

  const uuid = typeof info.uuid === 'string' ? info.uuid.slice(0, 64) : ''
  const rdns =
    typeof info.rdns === 'string' && info.rdns.length <= 128 && RDNS_PATTERN.test(info.rdns)
      ? info.rdns
      : ''
  const id = rdns.length > 0 ? rdns : uuid

  if (id.length === 0) return null

  return {
    id,
    uuid,
    name: name.slice(0, MAX_NAME_LENGTH),
    icon: safeWalletIcon(info.icon),
    rdns,
    verified: isVerifiedRdns(rdns),
    provider,
  }
}

/**
 * Merge a new announcement into the set already seen. The first provider to
 * claim an id keeps it; a different provider claiming the same id is a spoof
 * or a clash, so the entry is kept but marked unverified for the session.
 * Returns the entry to store and whether listeners need to hear about it.
 */
export function mergeAnnouncement(
  previous: AnnouncedWallet | undefined,
  next: AnnouncedWallet,
): { wallet: AnnouncedWallet; changed: boolean } {
  if (previous === undefined) return { wallet: next, changed: true }
  if (previous.provider === next.provider) return { wallet: previous, changed: false }
  if (!previous.verified) return { wallet: previous, changed: false }
  return { wallet: { ...previous, verified: false }, changed: true }
}

/* ----------------------------------------------------------------- Substrate */

export type SubstrateAccount = {
  address: string
  name?: string
  type?: string
  genesisHash?: string | null
}

/**
 * Keep only well-formed accounts whose address is valid SS58 for the generic
 * prefix. Invalid entries are dropped, never displayed or stored.
 */
export function normalizeSubstrateAccounts(
  value: unknown,
  prefix: number = SS58_PREFIX,
): SubstrateAccount[] {
  if (!Array.isArray(value)) return []

  const accounts: SubstrateAccount[] = []
  const seen = new Set<string>()

  for (const item of value) {
    if (!isRecord(item) || !isValidSs58(item.address, prefix)) continue
    const address = item.address as string
    if (seen.has(address)) continue
    seen.add(address)

    const account: SubstrateAccount = { address }
    if (typeof item.name === 'string') account.name = item.name.slice(0, MAX_NAME_LENGTH)
    if (typeof item.type === 'string') account.type = item.type
    if (typeof item.genesisHash === 'string' || item.genesisHash === null) {
      account.genesisHash = item.genesisHash
    }
    accounts.push(account)
  }

  return accounts
}
