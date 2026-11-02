/**
 * Substrate extension discovery and account access.
 *
 * Extensions expose themselves on `window.injectedWeb3` under a stable id
 * (`polkadot-js`, `talisman`, `subwallet-js`, ...). Enabling one returns its
 * accounts and, in most extensions, a live account subscription.
 *
 * Read-only: accounts are read, never signed with. No transaction is built and
 * no seed or private key is ever touched.
 */

export type SubstrateAccount = {
  address: string
  name?: string
  type?: string
  genesisHash?: string | null
}

/** The subset of the extension's accounts API this console relies on. */
export type SubstrateAccountsApi = {
  get: (anyType?: boolean) => Promise<SubstrateAccount[]>
  subscribe?: (listener: (accounts: SubstrateAccount[]) => void) => unknown
}

export type SubstrateExtension = {
  accounts: SubstrateAccountsApi
  [key: string]: unknown
}

export type SubstrateWallet = {
  /** The key the extension uses on `window.injectedWeb3`. */
  id: string
  name: string
  version: string | null
}

type InjectedEntry = {
  version?: string
  enable: (originName: string) => Promise<unknown>
}

declare global {
  interface Window {
    injectedWeb3?: Record<string, unknown>
  }
}

const EXTENSION_NAMES: Record<string, string> = {
  'polkadot-js': 'Polkadot.js',
  talisman: 'Talisman',
  'subwallet-js': 'SubWallet',
  enkrypt: 'Enkrypt',
  'nova-wallet': 'Nova Wallet',
}

/** A readable name for an extension id, without inventing one for unknown ids. */
export function extensionLabel(id: string): string {
  const known = EXTENSION_NAMES[id]
  if (known !== undefined) return known

  return id
    .split(/[-_.]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isInjectedEntry(value: unknown): value is InjectedEntry {
  return isRecord(value) && typeof value.enable === 'function'
}

function isSubstrateExtension(value: unknown): value is SubstrateExtension {
  if (!isRecord(value) || !isRecord(value.accounts)) return false
  return typeof value.accounts.get === 'function'
}

function normalizeAccounts(value: unknown): SubstrateAccount[] {
  if (!Array.isArray(value)) return []

  const accounts: SubstrateAccount[] = []

  for (const item of value) {
    if (!isRecord(item) || typeof item.address !== 'string' || item.address.length === 0) {
      continue
    }

    accounts.push({
      address: item.address,
      ...(typeof item.name === 'string' ? { name: item.name } : {}),
      ...(typeof item.type === 'string' ? { type: item.type } : {}),
      ...(typeof item.genesisHash === 'string' || item.genesisHash === null
        ? { genesisHash: item.genesisHash }
        : {}),
    })
  }

  return accounts
}

function readInjectedWeb3(): Record<string, InjectedEntry> {
  if (typeof window === 'undefined') return {}

  const injected = window.injectedWeb3
  if (!isRecord(injected)) return {}

  const entries: Record<string, InjectedEntry> = {}

  for (const [id, value] of Object.entries(injected)) {
    if (isInjectedEntry(value)) entries[id] = value
  }

  return entries
}

/** Every extension currently injected into the page, sorted by display name. */
export function listSubstrateWallets(): SubstrateWallet[] {
  return Object.entries(readInjectedWeb3())
    .map(([id, entry]) => ({
      id,
      name: extensionLabel(id),
      version: typeof entry.version === 'string' ? entry.version : null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Enable an extension for this origin and read its accounts. This can prompt
 * the user the first time; callers should treat it as an explicit action.
 */
export async function enableSubstrateWallet(
  id: string,
  originName = 'LEMO',
): Promise<{ extension: SubstrateExtension; accounts: SubstrateAccount[] }> {
  const entry = readInjectedWeb3()[id]

  if (entry === undefined) {
    throw new Error(`${extensionLabel(id)} is not installed in this browser.`)
  }

  const enabled = await entry.enable(originName)

  if (!isSubstrateExtension(enabled)) {
    throw new Error(`${extensionLabel(id)} did not expose an accounts API.`)
  }

  const accounts = normalizeAccounts(await enabled.accounts.get())

  return { extension: enabled, accounts }
}

/**
 * Follow account changes in an enabled extension. Returns an unsubscribe
 * function; it is a no-op when the extension has no `subscribe`.
 */
export function subscribeSubstrateAccounts(
  extension: SubstrateExtension,
  listener: (accounts: SubstrateAccount[]) => void,
): () => void {
  const subscribe = extension.accounts.subscribe

  if (typeof subscribe !== 'function') return () => {}

  let closed = false
  let unsubscribe: (() => void) | null = null

  const handleAccounts = (accounts: unknown) => {
    if (closed) return
    listener(normalizeAccounts(accounts))
  }

  try {
    const result = subscribe.call(extension.accounts, handleAccounts)

    if (typeof result === 'function') {
      unsubscribe = result as () => void
    } else if (result !== null && typeof result === 'object' && 'then' in result) {
      void (result as Promise<unknown>)
        .then((value) => {
          if (typeof value !== 'function') return
          if (closed) {
            ;(value as () => void)()
            return
          }
          unsubscribe = value as () => void
        })
        .catch(() => {
          // A failed subscription leaves the account read above in place.
        })
    }
  } catch {
    return () => {}
  }

  return () => {
    closed = true
    unsubscribe?.()
  }
}
