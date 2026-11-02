import { LiveNetworkStrip } from '@/components/site/live-strip'
import { Lifecycle } from '@/components/site/lifecycle'
import { SiteFooter } from '@/components/site/footer'
import { SiteHero } from '@/components/site/hero'
import { SiteNav } from '@/components/site/nav'
import { Problem } from '@/components/site/problem'
import { Protocol } from '@/components/site/protocol'
import { RecordPanel } from '@/components/site/record'
import { Rules } from '@/components/site/rules'
import { Status } from '@/components/site/status'

export default function SpecPage() {
  return (
    <div className="min-h-svh">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <SiteNav />

      <main id="main">
        <SiteHero />
        <LiveNetworkStrip />
        <Problem />
        <Protocol />
        <Rules />
        <Lifecycle />
        <RecordPanel />
        <Status />
      </main>

      <SiteFooter />
    </div>
  )
}
