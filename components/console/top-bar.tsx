'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowUpRight, ChevronRight } from 'lucide-react'

import { LiveStatus, RefreshButton } from '@/components/console/live-status'
import { currentNav } from '@/components/console/navigation'
import { usePortaldotWallet } from '@/lib/wallet/use-portaldot-wallet'

/** The one wallet status for the whole console: the same connection Transact and Verify use. */
function WalletStatus() {
  const wallet = usePortaldotWallet()
  if (wallet.connected) {
    return (
      <span className="inline-flex h-10 items-center gap-2 px-2.5 font-mono text-[12px] text-ink-2" title={wallet.address}>
        <span aria-hidden="true" className="size-1.5 rounded-full bg-ok" />
        {wallet.address.slice(0, 6)}…{wallet.address.slice(-5)}
      </span>
    )
  }
  return (
    <Link
      href="/console/flow"
      className="inline-flex h-10 items-center px-2.5 text-[13px] text-muted transition-colors duration-150 hover:text-ink"
    >
      {wallet.connecting ? 'Reconnecting wallet' : 'Wallet not connected'}
    </Link>
  )
}

export function TopBar() {
  const pathname = usePathname()
  const item = currentNav(pathname)

  return (
    <div className="sticky top-0 z-30 hidden h-16 items-center justify-between gap-6 border-b border-line bg-canvas px-8 lg:flex">
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href="/console"
          className="shrink-0 text-[13px] text-muted transition-colors duration-150 hover:text-ink-2"
        >
          Console
        </Link>
        <ChevronRight className="size-4 shrink-0 text-muted" strokeWidth={1.6} aria-hidden="true" />
        <span className="truncate text-[13px] text-ink-2">{item?.label ?? 'Console'}</span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <LiveStatus />
        <RefreshButton />
        <span aria-hidden="true" className="mx-1 h-4 w-px bg-line" />
        <WalletStatus />
        <Link
          href="/"
          className="inline-flex h-10 items-center gap-1.5 rounded-sm border border-transparent px-2.5 text-[13px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:bg-surface hover:text-ink"
        >
          Protocol
          <ArrowUpRight className="size-4 text-muted" strokeWidth={1.6} aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}
