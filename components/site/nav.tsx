import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'

import { LemoMark } from '@/components/brand'

const SECTIONS = [
  { href: '#protocol', label: 'Protocol' },
  { href: '#rules', label: 'Rules' },
  { href: '#lifecycle', label: 'Lifecycle' },
  { href: '#status', label: 'Status' },
]

/**
 * One line at every width: mark, section anchors, console action. The anchors
 * drop below md, the action never does.
 */
export function SiteNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-md">
      <div className="wrap flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex min-w-0 items-center gap-2.5" aria-label="LEMO home">
          <LemoMark className="size-[18px] shrink-0 text-accent-bright" />
          <span className="text-[15px] font-medium tracking-[-0.01em] text-ink">LEMO</span>
          <span className="hidden text-[12px] text-muted sm:inline">
            Protocol design
          </span>
        </Link>

        <nav aria-label="Page sections" className="hidden items-center gap-7 md:flex">
          {SECTIONS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-[13px] text-ink-2 transition-colors duration-150 hover:text-ink"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <Link href="/console" className="btn btn--solid btn--sm shrink-0">
          Open console
          <ArrowUpRight aria-hidden="true" className="size-3.5" strokeWidth={1.6} />
        </Link>
      </div>
    </header>
  )
}
