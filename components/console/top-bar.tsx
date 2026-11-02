'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowUpRight, ChevronRight } from 'lucide-react'

import { LiveStatus, RefreshButton } from '@/components/console/live-status'
import { currentNav } from '@/components/console/navigation'

export function TopBar() {
  const pathname = usePathname()
  const item = currentNav(pathname)

  return (
    <div className="sticky top-0 z-30 hidden h-14 items-center justify-between gap-6 border-b border-line bg-canvas px-7 lg:flex">
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href="/console"
          className="shrink-0 font-mono text-[10px] text-muted transition-colors duration-150 hover:text-ink-2"
        >
          Console
        </Link>
        <ChevronRight className="size-3 shrink-0 text-muted" strokeWidth={1.8} aria-hidden="true" />
        <span className="truncate text-[13px] font-medium text-ink">{item?.label ?? 'Console'}</span>
        {item === undefined ? null : (
          <>
            <span aria-hidden="true" className="mx-1.5 h-3 w-px shrink-0 bg-line" />
            <span className="truncate text-[12px] text-ink-2/80">{item.detail}</span>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <LiveStatus />
        <RefreshButton />
        <span aria-hidden="true" className="mx-1 h-4 w-px bg-line" />
        <Link
          href="/"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-transparent px-2 text-[12px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:bg-surface hover:text-ink"
        >
          Specification
          <ArrowUpRight className="size-3.5 text-muted" strokeWidth={1.6} aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}
