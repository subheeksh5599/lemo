'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowUpRight } from 'lucide-react'

import { LemoMark } from '@/components/brand'
import { useConsole } from '@/components/console/console-provider'
import { LiveStatus, RefreshButton } from '@/components/console/live-status'
import { NAV } from '@/components/console/navigation'
import { TopBar } from '@/components/console/top-bar'
import { formatInt } from '@/lib/format'
import { cn } from '@/lib/utils'

const STATUS_WORD = {
  reading: 'reading',
  live: 'live',
  stale: 'stale',
  down: 'unreachable',
} as const

const STATUS_DOT = {
  reading: 'bg-faint',
  live: 'bg-ok',
  stale: 'bg-warn',
  down: 'bg-bad',
} as const

function SidebarNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Console" className="flex flex-col gap-0.5 px-2 pt-3">
      <p className="meta px-2.5 pb-1.5">Read</p>
      {NAV.map((item) => {
        const active = pathname === item.href
        const Icon = item.icon

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group relative flex h-9 items-center gap-2.5 rounded-[7px] px-2.5 text-[13px] transition-colors duration-150',
              active
                ? 'bg-raised text-ink shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]'
                : 'text-ink-2 hover:bg-surface hover:text-ink',
            )}
          >
            {active ? (
              <span
                aria-hidden="true"
                className="absolute inset-y-[7px] -left-2 w-[2px] rounded-full bg-accent"
              />
            ) : null}
            <Icon
              className={cn(
                'size-[15px] shrink-0 transition-colors duration-150',
                active ? 'text-accent' : 'text-muted group-hover:text-muted',
              )}
              strokeWidth={1.6}
              aria-hidden="true"
            />
            <span className="truncate">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

function MobileNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Console sections"
      className="flex items-center gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {NAV.map((item) => {
        const active = pathname === item.href
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-8 shrink-0 items-center rounded-md px-2.5 text-[12.5px] transition-colors duration-150',
              active ? 'bg-raised text-ink' : 'text-ink-2/80 hover:text-ink',
            )}
          >
            {item.label}
            {active ? <span aria-hidden="true" className="ml-1.5 h-1 w-1 rounded-full bg-accent" /> : null}
          </Link>
        )
      })}
    </nav>
  )
}

function SidebarFooter() {
  const { native, status } = useConsole()

  return (
    <div className="mt-auto border-t border-line px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="meta">finalized</span>
        <span className="font-mono text-[12px] tabular-nums text-ink">
          {native === null ? '-' : `#${formatInt(native.finalized.number)}`}
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[status])} />
          <span className="truncate text-[11.5px] text-ink-2">{STATUS_WORD[status]}</span>
        </span>
        <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted">
          {native === null ? '' : `${formatInt(native.latencyMs)} ms`}
        </span>
      </div>
      <p className="mt-2 truncate font-mono text-[10.5px] text-muted">
        {native?.chain ?? 'connecting'}
      </p>
      <Link
        href="/"
        className="mt-3 flex items-center justify-between gap-2 rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink"
      >
        Specification
        <ArrowUpRight className="size-3.5 text-muted" strokeWidth={1.6} aria-hidden="true" />
      </Link>
    </div>
  )
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-canvas">
      <a href="#console-main" className="skip-link">
        Skip to console content
      </a>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[236px] flex-col border-r border-line bg-canvas lg:flex">
        <Link
          href="/"
          className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4 transition-colors duration-150 hover:bg-surface/70"
        >
          <LemoMark className="size-[18px] shrink-0 text-accent" />
          <span className="text-[14.5px] font-medium tracking-[-0.01em] text-ink">LEMO</span>
          <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
            console
          </span>
        </Link>

        <SidebarNav />
        <SidebarFooter />
      </aside>

      <div className="lg:pl-[236px]">
        <div className="sticky top-0 z-30 border-b border-line bg-canvas/92 backdrop-blur-md lg:hidden">
          <div className="flex h-12 items-center gap-2 px-4">
            <Link href="/" className="flex items-center gap-2">
              <LemoMark className="size-4 text-accent" />
              <span className="text-[14px] font-medium text-ink">LEMO</span>
            </Link>
            <div className="ml-auto flex items-center gap-1.5">
              <LiveStatus />
              <RefreshButton />
            </div>
          </div>
          <MobileNav />
        </div>

        <TopBar />

        <main
          id="console-main"
          className="mx-auto w-full max-w-[1460px] px-4 pb-20 pt-4 sm:px-6 lg:px-7 lg:pt-5"
        >
          {children}
        </main>
      </div>
    </div>
  )
}
