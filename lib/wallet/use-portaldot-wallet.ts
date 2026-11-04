'use client'

/**
 * One Portaldot wallet connection for the whole console.
 *
 * Transact and Verify read the same connection, and it survives navigation and
 * reloads: the chosen extension and address are remembered in localStorage and
 * re-enabled silently on load (extensions keep the site's authorization, so no
 * prompt appears). Nothing secret is stored: only the extension id and address.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'

import type { SubstrateAccount } from './substrate'
import { connectSigner, listSubstrateWallets, type Signer } from './sign'

type State = {
  wallets: { id: string; name: string }[]
  walletId: string
  accounts: SubstrateAccount[]
  address: string
  signer: Signer | null
  connecting: boolean
  error: string | null
}

const KEY = 'lemo.wallet'
let state: State = { wallets: [], walletId: '', accounts: [], address: '', signer: null, connecting: false, error: null }
const listeners = new Set<() => void>()
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const SERVER: State = state

function remember() {
  try {
    if (state.signer !== null) localStorage.setItem(KEY, JSON.stringify({ walletId: state.walletId, address: state.address }))
    else localStorage.removeItem(KEY)
  } catch {
    // storage unavailable: the connection just will not persist
  }
}

async function connect(id: string, preferred?: string): Promise<void> {
  set({ connecting: true, error: null })
  try {
    const c = await connectSigner(id)
    const address = c.accounts.find((a) => a.address === preferred)?.address ?? c.accounts[0]?.address ?? ''
    set({ walletId: id, accounts: c.accounts, address, signer: c.signer, connecting: false })
    remember()
  } catch (error) {
    set({ connecting: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * The signer and address to use right now. Reads the live store (never a stale
 * render), and connects first when no connection is open, so a button press
 * never fails just because the page lost track of the wallet.
 */
export async function ensureSigner(): Promise<{ address: string; signer: Signer }> {
  if (state.signer === null || state.address === '') {
    start()
    if (state.wallets.length === 0) set({ wallets: listSubstrateWallets() })
    const id = state.walletId || state.wallets[0]?.id || ''
    if (id === '') throw new Error('No Portaldot wallet extension found in this browser. Install Talisman, SubWallet or Polkadot.js and reload.')
    await connect(id, state.address || undefined)
  }
  if (state.signer === null || state.address === '') {
    throw new Error(state.error ?? 'The wallet did not share an account with this page. Open the extension, allow this site, and press again.')
  }
  return { address: state.address, signer: state.signer }
}

let started = false
function start() {
  if (started || typeof window === 'undefined') return
  started = true
  const scan = () => {
    const wallets = listSubstrateWallets()
    set({ wallets, walletId: state.walletId || wallets[0]?.id || '' })
    return wallets
  }
  scan()
  // extensions inject after load; then restore the last connection
  setTimeout(() => {
    const wallets = scan()
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { walletId?: string; address?: string } | null
      if (saved?.walletId && state.signer === null && wallets.some((w) => w.id === saved.walletId)) {
        void connect(saved.walletId, saved.address)
      }
    } catch {
      // nothing saved
    }
  }, 900)
}

export function usePortaldotWallet() {
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER)
  useEffect(start, [])
  return {
    ...s,
    connected: s.signer !== null && s.address !== '',
    setWalletId: useCallback((walletId: string) => set({ walletId }), []),
    setAddress: useCallback((address: string) => {
      set({ address })
      remember()
    }, []),
    connect: useCallback(() => connect(state.walletId), []),
    disconnect: useCallback(() => {
      set({ signer: null, accounts: [], address: '' })
      remember()
    }, []),
  }
}
