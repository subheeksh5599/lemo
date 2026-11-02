'use client'

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ExternalLink, Loader2, Wallet, X } from 'lucide-react'

import { useWallet, type WalletStatus } from '@/components/wallet/wallet-provider'
import { shortHash } from '@/lib/format'
import { cn } from '@/lib/utils'

const INSTALL_LINKS = {
  evm: [
    { name: 'MetaMask', href: 'https://metamask.io/download/' },
    { name: 'Rabby', href: 'https://rabby.io/' },
    { name: 'Coinbase Wallet', href: 'https://www.coinbase.com/wallet/downloads' },
  ],
  substrate: [
    { name: 'Talisman', href: 'https://talisman.xyz/download' },
    { name: 'SubWallet', href: 'https://www.subwallet.app/download.html' },
    { name: 'Polkadot.js', href: 'https://polkadot.js.org/extension/' },
  ],
} as const

const TRIGGER_LABEL: Record<WalletStatus, string> = {
  detecting: 'Connect wallet',
  idle: 'Connect wallet',
  connecting: 'Connecting',
  connected: 'Connected',
  error: 'Connect wallet',
}

function initials(name: string): string {
  const parts = name.split(/[\s._-]+/).filter((part) => part.length > 0)
  if (parts.length === 0) return '?'
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

function WalletGlyph({ name, icon }: { name: string; icon: string | null }) {
  const [failed, setFailed] = useState(false)

  if (icon !== null && !failed) {
    return (
      <img
        src={icon}
        alt=""
        aria-hidden="true"
        className="size-6"
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <span aria-hidden="true" className="font-mono text-[11px] text-ink-2">
      {initials(name)}
    </span>
  )
}

function InstallLinks({ kind }: { kind: 'evm' | 'substrate' }) {
  return (
    <ul className="flex flex-wrap gap-2 px-3 pb-3 pt-1">
      {INSTALL_LINKS[kind].map((link) => (
        <li key={link.href}>
          <a
            href={link.href}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex h-11 items-center gap-1.5 rounded-[6px] border border-line px-3 text-[12px] text-ink-2 transition-colors duration-150 hover:border-line-bright hover:text-ink"
          >
            {link.name}
            <ExternalLink className="size-3 text-muted" aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  )
}

function Group({
  title,
  detail,
  children,
}: {
  title: string
  detail: string
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="border-t border-line first:border-t-0">
      <div className="flex items-baseline justify-between gap-3 px-4 pb-2 pt-3.5">
        <h3 className="text-[12px] font-medium text-ink-2">
          {title}
        </h3>
        <span className="meta">{detail}</span>
      </div>
      {children}
    </section>
  )
}

export function WalletMenu({ className }: { className?: string }) {
  const {
    evmWallets,
    substrateWallets,
    activeAccount,
    chain,
    status,
    error,
    connect,
    disconnect,
  } = useWallet()

  const [open, setOpen] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  const empty = evmWallets.length === 0 && substrateWallets.length === 0
  const busy = status === 'connecting'

  const close = useCallback(() => {
    setOpen(false)
    window.setTimeout(() => triggerRef.current?.focus(), 0)
  }, [])

  const openDialog = useCallback(() => {
    setOpen(true)
  }, [])

  // Move focus into the dialog when it opens; the panel itself is focusable.
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => panelRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  // Escape to close, Tab contained, and the page behind the dialog held still.
  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }

      if (event.key !== 'Tab') return

      const panel = panelRef.current
      if (panel === null) return

      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null)

      if (focusable.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (first === undefined || last === undefined) return

      if (event.shiftKey) {
        if (active === first || active === panel || !panel.contains(active)) {
          event.preventDefault()
          last.focus()
        }
        return
      }

      if (active === last || active === panel || !panel.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  const handleConnect = useCallback(
    async (walletId: string) => {
      setPendingId(walletId)
      try {
        await connect(walletId)
      } finally {
        setPendingId(null)
      }
    },
    [connect],
  )

  const triggerText =
    activeAccount === null
      ? TRIGGER_LABEL[status]
      : shortHash(activeAccount.address, 6, 4)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openDialog}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'inline-flex h-11 min-h-11 items-center gap-2 rounded-[7px] border border-line-strong bg-raised px-3.5 text-[13px] font-medium text-ink transition-colors duration-150 hover:border-line-bright hover:bg-overlay',
          className,
        )}
      >
        {status === 'connecting' ? (
          <Loader2 className="size-4 animate-spin text-ink-2" strokeWidth={1.8} aria-hidden="true" />
        ) : activeAccount === null ? (
          <Wallet className="size-4 text-ink-2" strokeWidth={1.7} aria-hidden="true" />
        ) : (
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 rounded-full',
              status === 'error' ? 'bg-bad' : 'bg-ok',
            )}
          />
        )}

        <span className={activeAccount === null ? undefined : 'font-mono text-[12px]'}>
          {triggerText}
        </span>

        {activeAccount !== null && chain !== null ? (
          <span className="hidden text-[11.5px] text-muted sm:inline">{chain.label}</span>
        ) : null}

        <ChevronDown className="size-3.5 text-muted" strokeWidth={1.8} aria-hidden="true" />
      </button>

      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-void/80 p-4 pt-[10vh]"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) close()
              }}
            >
              <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                tabIndex={-1}
                className="w-full max-w-[480px] overflow-hidden rounded-[12px] border border-line-strong bg-surface shadow-[0_24px_64px_-32px_rgba(0,0,0,0.85)] outline-none"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3.5">
                  <div className="min-w-0">
                    <h2 id={titleId} className="text-[15px] font-medium tracking-[-0.01em] text-ink">
                      {activeAccount === null ? 'Connect a wallet' : 'Wallet session'}
                    </h2>
                    <p id={descriptionId} className="mt-0.5 text-[12px] leading-5 text-muted">
                      Read-only. LEMO asks for an address, never a signature.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={close}
                    aria-label="Close wallet dialog"
                    className="-mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-[6px] text-muted transition-colors duration-150 hover:bg-raised hover:text-ink"
                  >
                    <X className="size-4" strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </header>

                {activeAccount !== null && chain !== null ? (
                  <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] text-ink">
                        {activeAccount.walletName}
                        <span aria-hidden="true" className="px-1.5 text-faint">
                          /
                        </span>
                        <span className="font-mono text-[11.5px] text-ink-2">
                          {shortHash(activeAccount.address, 8, 6)}
                        </span>
                      </p>
                      <p className="meta mt-1 truncate">
                        {chain.label}
                        {activeAccount.kind === 'substrate' ? ' · native account' : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={disconnect}
                      className="inline-flex h-11 shrink-0 items-center rounded-[6px] border border-line-strong px-3 text-[12px] text-ink-2 transition-colors duration-150 hover:border-line-bright hover:text-ink"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : null}

                {error !== null ? (
                  <p
                    role="alert"
                    className="border-b border-bad/30 bg-bad-soft px-4 py-2.5 text-[12px] leading-5 text-[#ff9b94]"
                  >
                    {error}
                  </p>
                ) : null}

                <div className="max-h-[min(64vh,480px)] overflow-y-auto">
                  {empty ? (
                    <p className="border-b border-line px-4 py-3 text-[12.5px] leading-5 text-ink-2">
                      No browser wallet detected. Install one below, then reload this page.
                    </p>
                  ) : null}

                  <Group
                    title="EVM"
                    detail={evmWallets.length === 0 ? 'none' : `${evmWallets.length} detected`}
                  >
                    {evmWallets.length === 0 ? (
                      <>
                        <p className="px-4 text-[12px] leading-5 text-muted">
                          No injected EVM wallet detected.
                        </p>
                        <InstallLinks kind="evm" />
                      </>
                    ) : (
                      <ul className="divide-y divide-line border-t border-line">
                        {evmWallets.map((wallet) => {
                          const walletId = `evm:${wallet.id}`
                          const isActive = activeAccount?.walletId === walletId
                          const isPending = pendingId === walletId

                          return (
                            <li
                              key={wallet.id}
                              className="flex items-center gap-3 px-4 py-2.5"
                            >
                              <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-[7px] border border-line bg-raised">
                                <WalletGlyph name={wallet.name} icon={wallet.icon} />
                              </span>

                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-medium text-ink">
                                  {wallet.name}
                                </p>
                                <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted">
                                  {isActive && activeAccount !== null
                                    ? `${shortHash(activeAccount.address, 6, 4)}${
                                        chain === null ? '' : ` · ${chain.label}`
                                      }`
                                    : wallet.rdns.length > 0
                                      ? wallet.rdns
                                      : 'Injected provider'}
                                </p>
                              </div>

                              {isActive ? (
                                <div className="flex shrink-0 items-center gap-1.5">
                                  <span className="hidden items-center gap-1 font-mono text-[10px] text-ok sm:inline-flex">
                                    <Check className="size-3" aria-hidden="true" />
                                    Linked
                                  </span>
                                  <button
                                    type="button"
                                    onClick={disconnect}
                                    className="inline-flex h-11 items-center rounded-[6px] border border-line-strong px-3 text-[12px] text-ink-2 transition-colors duration-150 hover:border-line-bright hover:text-ink"
                                  >
                                    Disconnect
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void handleConnect(walletId)}
                                  disabled={isPending || busy}
                                  aria-busy={isPending}
                                  className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[6px] bg-accent px-3.5 text-[12.5px] font-medium text-white transition-colors duration-150 hover:bg-[#3f78ff] disabled:cursor-not-allowed disabled:opacity-55"
                                >
                                  {isPending ? (
                                    <>
                                      <Loader2
                                        className="size-3.5 animate-spin"
                                        aria-hidden="true"
                                      />
                                      Connecting
                                    </>
                                  ) : (
                                    'Connect'
                                  )}
                                </button>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </Group>

                  <Group
                    title="Substrate"
                    detail={
                      substrateWallets.length === 0
                        ? 'none'
                        : `${substrateWallets.length} detected`
                    }
                  >
                    {substrateWallets.length === 0 ? (
                      <>
                        <p className="px-4 text-[12px] leading-5 text-muted">
                          No Substrate extension detected.
                        </p>
                        <InstallLinks kind="substrate" />
                      </>
                    ) : (
                      <ul className="divide-y divide-line border-t border-line">
                        {substrateWallets.map((wallet) => {
                          const walletId = `substrate:${wallet.id}`
                          const isActive = activeAccount?.walletId === walletId
                          const isPending = pendingId === walletId

                          return (
                            <li
                              key={wallet.id}
                              className="flex items-center gap-3 px-4 py-2.5"
                            >
                              <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-[7px] border border-line bg-raised">
                                <WalletGlyph name={wallet.name} icon={null} />
                              </span>

                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-medium text-ink">
                                  {wallet.name}
                                </p>
                                <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted">
                                  {isActive && activeAccount !== null
                                    ? `${shortHash(activeAccount.address, 6, 4)}${
                                        chain === null ? '' : ` · ${chain.label}`
                                      }`
                                    : wallet.version === null
                                      ? 'Browser extension'
                                      : `v${wallet.version}`}
                                </p>
                              </div>

                              {isActive ? (
                                <div className="flex shrink-0 items-center gap-1.5">
                                  <span className="hidden items-center gap-1 font-mono text-[10px] text-ok sm:inline-flex">
                                    <Check className="size-3" aria-hidden="true" />
                                    Linked
                                  </span>
                                  <button
                                    type="button"
                                    onClick={disconnect}
                                    className="inline-flex h-11 items-center rounded-[6px] border border-line-strong px-3 text-[12px] text-ink-2 transition-colors duration-150 hover:border-line-bright hover:text-ink"
                                  >
                                    Disconnect
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void handleConnect(walletId)}
                                  disabled={isPending || busy}
                                  aria-busy={isPending}
                                  className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[6px] bg-accent px-3.5 text-[12.5px] font-medium text-white transition-colors duration-150 hover:bg-[#3f78ff] disabled:cursor-not-allowed disabled:opacity-55"
                                >
                                  {isPending ? (
                                    <>
                                      <Loader2
                                        className="size-3.5 animate-spin"
                                        aria-hidden="true"
                                      />
                                      Connecting
                                    </>
                                  ) : (
                                    'Connect'
                                  )}
                                </button>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </Group>
                </div>

                <footer className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
                  <p className="meta">No transactions · no signatures</p>
                  <button
                    type="button"
                    onClick={close}
                    className="inline-flex h-11 items-center rounded-[6px] px-2 text-[12px] text-ink-2 transition-colors duration-150 hover:text-ink"
                  >
                    Done
                  </button>
                </footer>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
