import { PROBLEMS } from '@/lib/lemo'

const [LEAD, ...REST] = PROBLEMS

/**
 * Four problems, asymmetric: the first carries the argument at display scale,
 * the other three sit in a stacked column of hairlines.
 */
export function Problem() {
  return (
    <section id="problem" className="wrap border-t border-line py-20 md:py-28">
      <div className="max-w-[52ch]">
        <h2 className="text-ink">Two records, no shared storage</h2>
        <p className="lede mt-4 text-[15.5px]">
          Portaldot V3 ships Revive for EVM contracts and lists the native WASM
          contract module for V3.0. The native runtime already holds assets,
          identity, vesting and ownership records. The two environments share
          validators, not storage.
        </p>
      </div>

      <div className="mt-12 grid gap-y-10 md:mt-16 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-x-16">
        <article className="border-t border-line-strong pt-6">
          <span className="mono text-[10.5px] tabular-nums text-muted">01</span>
          <h3 className="mt-5 max-w-[22ch] text-[clamp(1.5rem,2.3vw,2.05rem)] leading-[1.08] tracking-[-0.03em] text-ink">
            {LEAD.title}
          </h3>
          <p className="mt-4 max-w-[46ch] text-[14.5px] leading-relaxed text-ink-2">
            Native rules do not follow an ERC-20 or ERC-721 representation on
            their own. A token can outlive the conditions that justified it.
          </p>
        </article>

        <ul className="list-none p-0">
          {REST.map((problem, index) => (
            <li
              key={problem.title}
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 border-t border-line py-5 last:pb-0"
            >
              <span className="mono pt-[3px] text-[10.5px] tabular-nums text-muted">
                {String(index + 2).padStart(2, '0')}
              </span>
              <div className="min-w-0">
                <h3 className="text-[15px] leading-snug text-ink">{problem.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">
                  {problem.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
