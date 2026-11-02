'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'

const NAV = [
  { label: 'Protocol', href: '#how' },
  { label: 'Proofs', href: '#stats' },
  { label: 'Security', href: '#security' },
  { label: 'FAQ', href: '#faq' },
]

export function Announcement() {
  return (
    <div className="relative z-[60] flex h-9 items-center justify-center gap-2 bg-[#0428cb] px-4 text-center text-[12px] text-white">
      <span className="truncate">
        Four support contracts live on Portaldot V3
      </span>
      <Link href="/console" className="inline-flex shrink-0 items-center gap-1 underline underline-offset-2">
        Open the console
        <ArrowUpRight className="size-3" aria-hidden="true" />
      </Link>
    </div>
  )
}

export function Header() {
  const [solid, setSolid] = useState(false)

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 h-16 transition-colors duration-200 ${
        solid ? 'bg-[#00052e]' : 'bg-transparent'
      }`}
    >
      <div className="mx-auto grid h-full max-w-[1400px] grid-cols-[1fr_auto_1fr] items-center px-6 text-white lg:px-12">
        <Link href="/" className="flex items-center gap-2.5 justify-self-start" aria-label="LEMO home">
          <span className="relative flex size-6 items-center justify-center">
            <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-sm bg-white" />
            <span className="absolute right-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-sm bg-[#6e94ff]" />
            <span className="h-3 w-[3px] rounded-sm bg-[#34fcff]" />
          </span>
          <span className="text-[22px] font-semibold tracking-[-0.04em]">lemo</span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center justify-center gap-8 md:flex">
          {NAV.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-white/90 transition-colors hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center justify-self-end gap-3">
          <Link
            href="/console"
            className="inline-flex h-10 items-center rounded-lg bg-[#0428cb] px-5 text-[14px] font-medium text-white transition-opacity hover:opacity-90"
          >
            Open console
          </Link>
        </div>
      </div>
    </header>
  )
}
