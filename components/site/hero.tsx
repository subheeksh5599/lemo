import Link from 'next/link'
import { ArrowRight, ArrowUpRight } from 'lucide-react'

import { RegisterSpecimen } from '@/components/site/register'

/**
 * Asymmetric split: the claim on the left, the register on the right. Four text
 * elements only (eyebrow, headline, lede, actions) so the hero lands in the
 * first viewport with room for the live strip underneath.
 */
export function SiteHero() {
  return (
    <section id="top" className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(58%_100%_at_16%_0%,rgba(47,107,255,0.16),transparent_72%)]"
      />

      <div className="wrap relative grid gap-12 pt-14 pb-14 md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] md:items-start md:gap-16 md:pt-20 md:pb-16">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="h-px w-8 bg-accent" />
            <p className="meta text-accent-bright">Protocol design</p>
          </div>

          <h1 className="mt-6 max-w-[17ch] text-[clamp(2.45rem,4.3vw,3.9rem)] leading-[0.99] text-ink">
            One asset, two runtimes, one title.
          </h1>

          <p className="mt-6 max-w-[46ch] text-[16px] leading-[1.66] text-ink-2">
            A design for one asset, one revisioned title, and a bidirectional
            proof gate between Portaldot&apos;s native runtime and Revive.
          </p>

          <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <Link href="/console" className="btn btn--solid">
              Open console
              <ArrowUpRight aria-hidden="true" className="size-4" strokeWidth={1.6} />
            </Link>
            <a href="#protocol" className="btn">
              Read the protocol
              <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.6} />
            </a>
          </div>
        </div>

        <RegisterSpecimen />
      </div>
    </section>
  )
}
