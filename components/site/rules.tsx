import { RULES } from '@/lib/lemo'

/**
 * Two rules, each shown as the gate it is: the condition that lets a call
 * through, and the condition that reverts it.
 */
export function Rules() {
  return (
    <section id="rules" className="wrap border-t border-line py-20 md:py-28">
      <div className="max-w-[54ch]">
        <h2 className="text-ink">Neither face moves alone</h2>
        <p className="lede mt-4 text-[15.5px]">
          Each runtime receives proof data and checks it against a finalized
          state. No relayer decides what is legitimate.
        </p>
      </div>

      <div className="mt-12 divide-y divide-line border-t border-line md:mt-14">
        {RULES.map((rule) => (
          <article
            key={rule.number}
            className="grid gap-8 py-9 md:grid-cols-[minmax(0,1fr)_minmax(0,360px)] md:gap-16"
          >
            <div className="min-w-0">
              <div className="flex items-baseline gap-3">
                <span className="mono text-[10.5px] tabular-nums text-muted">
                  {rule.number}
                </span>
                <span className="h-px flex-1 bg-line" aria-hidden="true" />
              </div>
              <h3 className="mt-4 max-w-[26ch] text-[clamp(1.2rem,1.7vw,1.5rem)] leading-[1.14] tracking-[-0.025em] text-ink">
                {rule.title}
              </h3>
              <p className="mt-3 max-w-[56ch] text-[14px] leading-relaxed text-ink-2">
                {rule.body}
              </p>
              <ul className="mt-5 list-none space-y-2 p-0">
                {rule.checks.map((check) => (
                  <li
                    key={check}
                    className="flex gap-2.5 text-[13px] leading-relaxed text-ink-2"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-[8px] size-[5px] shrink-0 rounded-full border border-line-bright"
                    />
                    {check}
                  </li>
                ))}
              </ul>
            </div>

            <dl className="min-w-0 self-start overflow-hidden rounded-[7px] border border-line bg-surface">
              <div className="grid grid-cols-[58px_minmax(0,1fr)] items-baseline gap-x-3 border-b border-line px-4 py-3">
                <dt className="mono text-[10px] uppercase tracking-[0.12em] text-ok">
                  allow
                </dt>
                <dd className="min-w-0">
                  <p className="text-[12.5px] leading-snug text-ink-2">
                    {rule.allowed}
                  </p>
                  <p className="mono mt-1.5 text-[11px] tabular-nums text-ok">
                    {rule.allowedResult}
                  </p>
                </dd>
              </div>
              <div className="grid grid-cols-[58px_minmax(0,1fr)] items-baseline gap-x-3 px-4 py-3">
                <dt className="mono text-[10px] uppercase tracking-[0.12em] text-bad">
                  revert
                </dt>
                <dd className="min-w-0">
                  <p className="text-[12.5px] leading-snug text-ink-2">
                    {rule.blocked}
                  </p>
                  <p className="mono mt-1.5 text-[11px] tabular-nums text-bad">
                    {rule.blockedResult}
                  </p>
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  )
}
