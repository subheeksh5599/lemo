'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  chainLabel,
  connectEvmWallet,
  readEvmAccounts,
  readEvmChainId,
  subscribeEvmProvider,
  subscribeEvmWallets,
  type EvmWallet,
} from '@/lib/wallet/eip6963'
import {
  enableSubstrateWallet,
  listSubstrateWallets,
  subscribeSubstrateAccounts,
  type SubstrateExtension,
  type SubstrateWallet,
} from '@/lib/wallet/substrate'

export type WalletKind = 'evm' | 'substrate'

export type WalletStatus = 'detecting' | 'idle' | 'connecting' | 'connected' | 'error'

export type ActiveWalletAccount = {
  /** Composite id: `evm:<rdns>` or `substrate:<extension id>`. */
  walletId: string
  walletName: string
  kind: WalletKind
  address: string
  /** EVM chain id reported by the wallet. Null for Substrate accounts. */
  chainId: number | null
}

export type WalletChain = {
  id: number | null
  label: string
}

export type WalletContextValue = {
  evmWallets: EvmWallet[]
  substrateWallets: SubstrateWallet[]
  /** The most recently connected account. What the header menu shows. */
  activeAccount: ActiveWalletAccount | null
  /** The EVM account that signs, held independently of the Substrate slot. */
  evmAccount: ActiveWalletAccount | null
  /** The Substrate account, held independently of the EVM slot. */
  substrateAccount: ActiveWalletAccount | null
  chain: WalletChain | null
  status: WalletStatus
  error: string | null
  connect: (walletId: string) => Promise<void>
  /** Clears both slots. */
  disconnect: () => void
  /** Clears one slot and leaves the other connected. */
  disconnectKind: (kind: WalletKind) => void
}

const WalletContext = createContext<WalletContextValue | null>(null)

/**
 * The only thing persisted: a wallet id. Never an address, never a chain.
 *
 * One kind is stored per key so a page that holds an EVM signer and a Substrate
 * identity at the same time can restore both.
 */
const LAST_WALLET_KEY = 'lemo.wallet.last'
const LAST_WALLET_EVM_KEY = 'lemo.wallet.evm'
const LAST_WALLET_SUBSTRATE_KEY = 'lemo.wallet.substrate'
const WALLET_ID_MAX_LENGTH = 160

function readStoredId(key: string, prefix: 'evm:' | 'substrate:'): string | null {
  try {
    const value = window.localStorage.getItem(key)
    if (value === null || value.length === 0 || value.length > WALLET_ID_MAX_LENGTH) {
      return null
    }
    if (!value.startsWith(prefix)) return null
    return value
  } catch {
    return null
  }
}

function rememberWalletId(walletId: string) {
  const key = walletId.startsWith('evm:') ? LAST_WALLET_EVM_KEY : LAST_WALLET_SUBSTRATE_KEY
  try {
    window.localStorage.setItem(LAST_WALLET_KEY, walletId)
    window.localStorage.setItem(key, walletId)
  } catch {
    // Storage can be denied in private modes; the session still works.
  }
}

function forgetWalletId(kind: WalletKind) {
  try {
    window.localStorage.removeItem(kind === 'evm' ? LAST_WALLET_EVM_KEY : LAST_WALLET_SUBSTRATE_KEY)
    // The combined key predates the per-kind slots; a leftover id there would
    // silently reconnect a wallet the user just disconnected.
    const last = window.localStorage.getItem(LAST_WALLET_KEY)
    if (last !== null && last.startsWith(`${kind}:`)) {
      window.localStorage.removeItem(LAST_WALLET_KEY)
    }
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

function walletErrorMessage(cause: unknown, name: string): string {
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const code = (cause as { code?: unknown }).code
    if (code === 4001) return `${name} declined the connection.`
    if (code === -32002) {
      return `${name} already has a pending request. Finish it in the extension.`
    }
  }

  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message
  }

  return `${name} could not be connected.`
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [evmWallets, setEvmWallets] = useState<EvmWallet[]>([])
  const [substrateWallets, setSubstrateWallets] = useState<SubstrateWallet[]>([])
  const [evmAccount, setEvmAccount] = useState<ActiveWalletAccount | null>(null)
  const [substrateAccount, setSubstrateAccount] = useState<ActiveWalletAccount | null>(null)
  const [activeAccount, setActiveAccount] = useState<ActiveWalletAccount | null>(null)
  const [status, setStatus] = useState<WalletStatus>('detecting')
  const [error, setError] = useState<string | null>(null)

  const slotsRef = useRef<{ evm: ActiveWalletAccount | null; substrate: ActiveWalletAccount | null }>(
    { evm: null, substrate: null },
  )
  const activeKindRef = useRef<WalletKind | null>(null)
  const evmWatchRef = useRef<(() => void) | null>(null)
  const substrateWatchRef = useRef<(() => void) | null>(null)
  const connectingRef = useRef(false)
  const connectionEpochRef = useRef(0)
  const mountedRef = useRef(true)
  const evmRestoreAttemptedRef = useRef(false)

  const syncActive = useCallback(() => {
    const slots = slotsRef.current
    const preferred = activeKindRef.current
    const next =
      preferred === 'substrate'
        ? (slots.substrate ?? slots.evm)
        : preferred === 'evm'
          ? (slots.evm ?? slots.substrate)
          : (slots.evm ?? slots.substrate)

    setActiveAccount(next)
  }, [])

  const setSlot = useCallback(
    (kind: WalletKind, account: ActiveWalletAccount | null) => {
      slotsRef.current = { ...slotsRef.current, [kind]: account }
      if (account === null && activeKindRef.current === kind) {
        activeKindRef.current = kind === 'evm' ? 'substrate' : 'evm'
      } else if (account !== null) {
        activeKindRef.current = kind
      }

      if (kind === 'evm') setEvmAccount(account)
      else setSubstrateAccount(account)

      syncActive()
    },
    [syncActive],
  )

  const clearEvmWatch = useCallback(() => {
    evmWatchRef.current?.()
    evmWatchRef.current = null
  }, [])

  const clearSubstrateWatch = useCallback(() => {
    substrateWatchRef.current?.()
    substrateWatchRef.current = null
  }, [])

  /** Follow the connected EVM wallet. Account and chain changes land in state. */
  const watchEvm = useCallback(
    (wallet: EvmWallet) => {
      clearEvmWatch()

      const walletId = `evm:${wallet.id}`

      const disconnectStale = () => {
        if (slotsRef.current.evm?.walletId !== walletId) return
        setSlot('evm', null)
        setStatus('idle')
        setError(null)
        forgetWalletId('evm')
      }

      evmWatchRef.current = subscribeEvmProvider(wallet.provider, {
        onAccounts: (accounts) => {
          const address = accounts[0]
          if (address === undefined) {
            disconnectStale()
            return
          }
          const current = slotsRef.current.evm
          if (current === null || current.walletId !== walletId) return
          setSlot('evm', { ...current, address })
        },
        onChain: (chainId) => {
          const current = slotsRef.current.evm
          if (current === null || current.walletId !== walletId) return
          setSlot('evm', { ...current, chainId })
        },
        onDisconnect: disconnectStale,
      })
    },
    [clearEvmWatch, setSlot],
  )

  /** Follow the connected Substrate extension's account subscription. */
  const watchSubstrate = useCallback(
    (wallet: SubstrateWallet, extension: SubstrateExtension) => {
      clearSubstrateWatch()

      const walletId = `substrate:${wallet.id}`

      substrateWatchRef.current = subscribeSubstrateAccounts(extension, (accounts) => {
        const current = slotsRef.current.substrate
        if (current === null || current.walletId !== walletId) return

        const address = accounts[0]?.address
        if (address === undefined) {
          setSlot('substrate', null)
          setStatus('idle')
          setError(null)
          forgetWalletId('substrate')
          return
        }

        setSlot('substrate', { ...current, address })
      })
    },
    [clearSubstrateWatch, setSlot],
  )

  // EIP-6963 discovery runs for the life of the provider.
  useEffect(() => {
    const unsubscribe = subscribeEvmWallets(setEvmWallets)
    return unsubscribe
  }, [])

  // Extensions inject at document start, but a few arrive after hydration.
  useEffect(() => {
    const scan = () => setSubstrateWallets(listSubstrateWallets())
    scan()

    const timers = [250, 800, 1600].map((delay) => window.setTimeout(scan, delay))
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setStatus((current) => (current === 'detecting' ? 'idle' : current))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [])

  /*
   * Restore only what the user already authorized: the stored wallet id is
   * enough to find the provider, and `eth_accounts` is a silent read. It never
   * calls `eth_requestAccounts` on load, so a page visit cannot prompt.
   *
   * The EVM slot restores on its own. The Substrate slot needs an explicit
   * `enable` call, which can prompt, so it is never restored unasked.
   */
  useEffect(() => {
    if (evmRestoreAttemptedRef.current) return

    const stored =
      readStoredId(LAST_WALLET_EVM_KEY, 'evm:') ?? readStoredId(LAST_WALLET_KEY, 'evm:')

    if (stored === null) {
      evmRestoreAttemptedRef.current = true
      return
    }

    const wallet = evmWallets.find((item) => `evm:${item.id}` === stored)
    if (wallet === undefined) return

    evmRestoreAttemptedRef.current = true

    void (async () => {
      const accounts = await readEvmAccounts(wallet.provider)
      const address = accounts[0]
      if (!mountedRef.current || address === undefined) return

      const chainId = await readEvmChainId(wallet.provider)
      if (!mountedRef.current) return

      watchEvm(wallet)
      setSlot('evm', {
        walletId: stored,
        walletName: wallet.name,
        kind: 'evm',
        address,
        chainId,
      })
      setStatus('connected')
      setError(null)
    })()
  }, [evmWallets, setSlot, watchEvm])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearEvmWatch()
      clearSubstrateWatch()
    }
  }, [clearEvmWatch, clearSubstrateWatch])

  const connect = useCallback(
    async (walletId: string) => {
      if (connectingRef.current) return

      // Accept either the composite id from the menu or the raw wallet id.
      const evm = evmWallets.find(
        (item) => walletId === item.id || walletId === `evm:${item.id}`,
      )
      const substrate = substrateWallets.find(
        (item) => walletId === item.id || walletId === `substrate:${item.id}`,
      )

      if (evm === undefined && substrate === undefined) {
        setError('That wallet is no longer available in this browser.')
        setStatus('error')
        return
      }

      const resolvedId =
        evm !== undefined
          ? `evm:${evm.id}`
          : substrate !== undefined
            ? `substrate:${substrate.id}`
            : walletId

      connectingRef.current = true
      const epoch = connectionEpochRef.current + 1
      connectionEpochRef.current = epoch
      setError(null)
      setStatus('connecting')

      const anyConnected = () =>
        slotsRef.current.evm !== null || slotsRef.current.substrate !== null

      try {
        if (evm !== undefined) {
          try {
            const { address, chainId } = await connectEvmWallet(evm)
            if (!mountedRef.current || connectionEpochRef.current !== epoch) return

            watchEvm(evm)
            setSlot('evm', {
              walletId: resolvedId,
              walletName: evm.name,
              kind: 'evm',
              address,
              chainId,
            })
            setStatus('connected')
            rememberWalletId(resolvedId)
          } catch (cause) {
            if (!mountedRef.current || connectionEpochRef.current !== epoch) return
            setError(walletErrorMessage(cause, evm.name))
            setStatus(anyConnected() ? 'connected' : 'error')
          }
          return
        }

        if (substrate === undefined) {
          setError('That wallet is no longer available in this browser.')
          setStatus('error')
          return
        }

        try {
          const { extension, accounts } = await enableSubstrateWallet(substrate.id)
          const address = accounts[0]?.address

          if (address === undefined) {
            throw new Error(`${substrate.name} has no account to share.`)
          }
          if (!mountedRef.current || connectionEpochRef.current !== epoch) return

          watchSubstrate(substrate, extension)
          setSlot('substrate', {
            walletId: resolvedId,
            walletName: substrate.name,
            kind: 'substrate',
            address,
            chainId: null,
          })
          setStatus('connected')
          rememberWalletId(resolvedId)
        } catch (cause) {
          if (!mountedRef.current || connectionEpochRef.current !== epoch) return
          setError(walletErrorMessage(cause, substrate.name))
          setStatus(anyConnected() ? 'connected' : 'error')
        }
      } finally {
        connectingRef.current = false
      }
    },
    [evmWallets, substrateWallets, setSlot, watchEvm, watchSubstrate],
  )

  const disconnectKind = useCallback(
    (kind: WalletKind) => {
      connectionEpochRef.current += 1
      if (kind === 'evm') clearEvmWatch()
      else clearSubstrateWatch()
      setSlot(kind, null)
      forgetWalletId(kind)
      setError(null)
      setStatus(slotsRef.current.evm !== null || slotsRef.current.substrate !== null ? 'connected' : 'idle')
    },
    [clearEvmWatch, clearSubstrateWatch, setSlot],
  )

  const disconnect = useCallback(() => {
    connectionEpochRef.current += 1
    clearEvmWatch()
    clearSubstrateWatch()
    activeKindRef.current = null
    setSlot('evm', null)
    setSlot('substrate', null)
    forgetWalletId('evm')
    forgetWalletId('substrate')
    setStatus('idle')
    setError(null)
  }, [clearEvmWatch, clearSubstrateWatch, setSlot])

  const chain = useMemo<WalletChain | null>(() => {
    if (activeAccount === null) return null
    if (activeAccount.kind === 'substrate') return { id: null, label: 'Substrate' }
    return { id: activeAccount.chainId, label: chainLabel(activeAccount.chainId) }
  }, [activeAccount])

  const value = useMemo<WalletContextValue>(
    () => ({
      evmWallets,
      substrateWallets,
      activeAccount,
      evmAccount,
      substrateAccount,
      chain,
      status,
      error,
      connect,
      disconnect,
      disconnectKind,
    }),
    [
      evmWallets,
      substrateWallets,
      activeAccount,
      evmAccount,
      substrateAccount,
      chain,
      status,
      error,
      connect,
      disconnect,
      disconnectKind,
    ],
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext)
  if (value === null) {
    throw new Error('useWallet must be read inside WalletProvider')
  }
  return value
}
