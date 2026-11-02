import { LIFECYCLE } from '@/lib/lemo'

/**
 * Five transitions on one rail: step, direction of proof travel, what has to
 * be proven, and what the revision does. One column per step on desktop.
 */
export function Lifecycle() {
  return (
    <section id="lifecycle" className="wrap border-t border-line py-20 md:py-28">
      <div className="max-w-[54ch]">
        <h2 className="text-ink">The life of a title</h2>
        <p className="lede mt-4 text-[15.5px]">
          Five transitions, each with a proof requirement. A change to the title
          retires every proof issued before it.
        </p>
      </div>

      <ol className="mt-12 grid list-none grid-cols-1 gap-0 p-0 md:mt-14 md:grid-cols-5">
        {LIFECYCLE.map((step) => (
          <li
            key={step.step}
            className="border-t border-line py-6 md:border-t-0 md:border-l md:border-line md:py-0 md:pl-5 md:first:border-l-0 md:first:pl-0"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="mono text-[10.5px] tabular-nums text-muted">
                {step.step}
              </span>
              <span className="mono text-[9.5px] tabular-nums text-muted">
                rev {step.revision}
              </span>
            </div>

            <h3 className="mt-2.5 text-[15px] text-ink">{step.name}</h3>
            <p className="mono mt-2 text-[9.5px] uppercase tracking-[0.1em] text-accent-bright">
              {step.direction}
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
              {step.headline}
            </p>

            <p className="mono mt-4 border-t border-line pt-3 text-[10.5px] leading-relaxed text-muted">
              {step.proof}
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}
