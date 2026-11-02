import Link from 'next/link'

import { LemoMark } from '@/components/brand'
import { PORTALDOT_DOCS_URL, REPO_URL, STATEMENT_STORE_URL } from '@/lib/lemo'

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="wrap grid gap-10 py-12 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-16">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <LemoMark className="size-[18px] text-accent-bright" />
            <span className="text-[15px] font-medium tracking-[-0.01em] text-ink">LEMO</span>
          </div>
          <p className="mt-4 max-w-[44ch] text-[13px] leading-relaxed text-ink-2">
            LEMO coordinates ownership between Portaldot&apos;s native runtime and
            its Revive EVM environment through finalized state proofs.
          </p>
        </div>

        <nav aria-label="Protocol" className="min-w-0">
          <p className="text-[11px] text-muted">Protocol</p>
          <ul className="mt-3 list-none space-y-2 p-0">
            <li>
              <a href="#protocol" className="text-[13px] text-ink-2 hover:text-ink">
                Dual-face model
              </a>
            </li>
            <li>
              <a href="#rules" className="text-[13px] text-ink-2 hover:text-ink">
                The two rules
              </a>
            </li>
            <li>
              <a href="#lifecycle" className="text-[13px] text-ink-2 hover:text-ink">
                Lifecycle
              </a>
            </li>
            <li>
              <a href="#status" className="text-[13px] text-ink-2 hover:text-ink">
                Implementation state
              </a>
            </li>
          </ul>
        </nav>

        <nav aria-label="Elsewhere" className="min-w-0">
          <p className="text-[11px] text-muted">Elsewhere</p>
          <ul className="mt-3 list-none space-y-2 p-0">
            <li>
              <Link href="/console" className="text-[13px] text-ink-2 hover:text-ink">
                Console
              </Link>
            </li>
            <li>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] text-ink-2 hover:text-ink"
              >
                Repository
              </a>
            </li>
            <li>
              <a
                href={PORTALDOT_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] text-ink-2 hover:text-ink"
              >
                Portaldot docs
              </a>
            </li>
            <li>
              <a
                href={STATEMENT_STORE_URL}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] text-ink-2 hover:text-ink"
              >
                Statement Store
              </a>
            </li>
          </ul>
        </nav>
      </div>

      <div className="wrap flex flex-col gap-2 border-t border-line py-4 sm:flex-row sm:items-baseline sm:justify-between">
        <p className="text-[11px] leading-relaxed text-muted">
          Protocol design, not deployed. Portaldot V3, native runtime and Revive.
        </p>
        <p className="text-[11px] text-muted">
          Register values are specimen constants. Network figures are read live.
        </p>
      </div>
    </footer>
  )
}
