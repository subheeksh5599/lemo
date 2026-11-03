import type { Metadata } from 'next'
import Link from 'next/link'

import { LemoMark } from '@/components/brand'

export const metadata: Metadata = {
  title: 'LEMO: Transaction receipt',
  description: 'One Portaldot V3 EVM receipt, read by hash from the configured endpoint.',
}

export default function TransactionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-canvas">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2">
            <LemoMark className="size-[18px] shrink-0 text-accent" />
            <span className="text-[15px] font-medium tracking-[-0.01em] text-ink">LEMO</span>
          </Link>
          <Link
            href="/console"
            className="ml-auto text-[13px] text-ink-2 transition-colors duration-150 hover:text-ink"
          >
            Console
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1120px] px-4 pb-24 pt-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  )
}
