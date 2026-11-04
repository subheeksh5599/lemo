'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { LemoMark } from '@/components/brand'
import { useConsole } from '@/components/console/console-provider'
import { LiveStatus, RefreshButton } from '@/components/console/live-status'
import { NAV, NAV_ACT, NAV_READ, type NavItem } from '@/components/console/navigation'
import { TopBar } from '@/components/console/top-bar'
import { formatInt } from '@/lib/format'
import { cn } from '@/lib/utils'

function NavLinks({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname()

  return (
    <>
      {items.map((item) => {
        const active = pathname === item.href
        const Icon = item.icon

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex h-10 items-center gap-3 rounded-sm px-2.5 text-[14px] transition-colors duration-150',
              active
                ? 'bg-raised text-ink'
                : 'text-ink-2 hover:bg-surface hover:text-ink',
            )}
          >
            <Icon
              className={cn('size-4 shrink-0', active ? 'text-accent' : 'text-muted')}
              strokeWidth={1.6}
              aria-hidden="true"
            />
            <span className="truncate">{item.label}</span>
          </Link>
        )
      })}
    </>
  )
}

function SidebarNav() {
  return (
    <nav aria-label="Console" className="flex flex-col gap-1 px-3 pt-4">
      <p className="meta px-2 pb-2">Read</p>
      <NavLinks items={NAV_READ} />
      <p className="meta px-2 pb-2 pt-4">Act</p>
      <NavLinks items={NAV_ACT} />
    </nav>
  )
}

function MobileNav() {
  const pathname = usePathname()
  const activeRef = useRef<HTMLAnchorElement | null>(null)

  // The row scrolls; bring the current section into view rather than leaving it
  // half off the right edge on a narrow screen.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [pathname])

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
            ref={active ? activeRef : undefined}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-9 shrink-0 items-center rounded-sm px-2.5 text-[13px] transition-colors duration-150',
              active ? 'bg-raised text-ink' : 'text-ink-2 hover:text-ink',
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

function SidebarFooter() {
  const { native } = useConsole()

  // Liveness lives in the top bar; the footer carries the chain the console is
  // pinned to and the height every read on the page is taken at.
  return (
    <div className="mt-auto border-t border-line px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="meta">Finalized</span>
        <span className="font-mono text-[13px] tabular-nums text-ink">
          {native === null ? '-' : `#${formatInt(native.finalized.number)}`}
        </span>
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-mono text-[11px] text-muted">
          {native?.chain ?? 'connecting'}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
          {native === null ? '' : `${formatInt(native.latencyMs)} ms`}
        </span>
      </div>
    </div>
  )
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-canvas">
      <a href="#console-main" className="skip-link">
        Skip to console content
      </a>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-line bg-canvas lg:flex">
        <Link
          href="/"
          className="flex h-16 shrink-0 items-center gap-2.5 border-b border-line px-4 transition-colors duration-150 hover:bg-surface"
        >
          <LemoMark className="size-[18px] shrink-0 text-accent" />
          <span className="text-[15px] font-medium tracking-[-0.01em] text-ink">LEMO</span>
          <span className="ml-auto font-mono text-[11px] text-muted">
            console
          </span>
        </Link>

        <SidebarNav />
        <SidebarFooter />
      </aside>

      <div className="lg:pl-[248px]">
        <div className="sticky top-0 z-30 border-b border-line bg-canvas lg:hidden">
          <div className="flex h-12 items-center gap-2 px-4">
            <Link href="/" className="flex items-center gap-2">
              <LemoMark className="size-4 text-accent" />
              <span className="text-[14px] font-medium text-ink">LEMO</span>
            </Link>
            <div className="ml-auto flex items-center gap-2">
              <LiveStatus />
              <RefreshButton />
            </div>
          </div>
          <MobileNav />
        </div>

        <TopBar />

        <main
          id="console-main"
          className="mx-auto w-full max-w-[1520px] px-4 pb-24 pt-4 sm:px-6 lg:px-8 lg:pt-6"
        >
          {children}
        </main>
      </div>
    </div>
  )
}
