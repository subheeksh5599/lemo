import { TITLE_RECORD_LINES } from '@/lib/lemo'

/** The commitment record, as the notation a verifier actually hashes. */
export function RecordPanel() {
  return (
    <section id="record" className="wrap border-t border-line py-20 md:py-28">
      <div className="grid gap-10 md:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] md:gap-16">
        <div className="min-w-0">
          <h2 className="text-ink">What the title commits to</h2>
          <p className="lede mt-4 text-[15.5px]">
            One identifier, one revision, one hash. The hash commits to the
            relationship, not to the validity of the state behind it.
          </p>
          <p className="mt-5 max-w-[42ch] text-[13px] leading-relaxed text-muted">
            A verifier rebuilds this record from the proof it is given. If the
            revision or the backing does not match, the gate stays shut.
          </p>
        </div>

        <div className="panel min-w-0 overflow-hidden">
          <div className="panel__head bg-raised/30">
            <span className="mono text-[11px] text-muted">title.lemo</span>
            <div className="flex items-center gap-2">
              <span className="badge badge--accent">Specimen</span>
              <span className="mono hidden text-[10px] uppercase tracking-[0.1em] text-muted sm:inline">
                read only
              </span>
            </div>
          </div>

          <div className="overflow-x-auto px-4 py-4">
            <ol className="list-none p-0">
              {TITLE_RECORD_LINES.map(([key, value], index) => {
                const brace = key === 'LEMO_TITLE {' || key === '}'
                return (
                  <li
                    key={`${key}-${index}`}
                    className="grid grid-cols-[20px_minmax(0,1fr)] items-baseline gap-x-3"
                  >
                    <span className="mono select-none text-right text-[10px] tabular-nums text-muted">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    {brace ? (
                      <span className="mono text-[11.5px] leading-6 text-muted sm:text-[12.5px]">
                        {key}
                      </span>
                    ) : (
                      <span className="mono grid grid-cols-[148px_minmax(0,1fr)] gap-x-3 text-[11.5px] leading-6 sm:grid-cols-[176px_minmax(0,1fr)] sm:text-[12.5px]">
                        <span className="truncate text-muted">{key.trim()}</span>
                        <span className="text-ink">{value}</span>
                      </span>
                    )}
                  </li>
                )
              })}
            </ol>
          </div>

          <p className="border-t border-line px-4 py-2.5 text-[10.5px] leading-relaxed text-ink-2">
            Notation shown with specimen values. No registry is deployed, so the
            console reads network state only.
          </p>
        </div>
      </div>
    </section>
  )
}
