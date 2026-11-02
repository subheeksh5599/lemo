import { FACES, TITLE } from '@/lib/lemo'

function Face({
  name,
  runtime,
  rows,
  className = '',
}: {
  name: string
  runtime: string
  rows: readonly { label: string; value: string }[]
  className?: string
}) {
  return (
    <div className={`min-w-0 px-4 py-3.5 ${className}`}>
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <p className="text-[12px] font-medium text-ink">{name}</p>
        <span className="mono text-[10px] uppercase tracking-[0.1em] text-muted">
          {runtime}
        </span>
      </div>
      <dl className="space-y-0">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-4 py-[7px] last:pb-0"
          >
            <dt className="text-[11.5px] text-muted">{row.label}</dt>
            <dd className="mono text-[11.5px] tabular-nums text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * The specimen register. Every figure here is a protocol constant from the
 * design, so the panel says so out loud and points at the console for real
 * readings. Nothing on this card is presented as a live chain value.
 */
export function RegisterSpecimen() {
  return (
    <div className="min-w-0">
      <div className="panel overflow-hidden">
        <div className="panel__head bg-raised/30">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium tracking-[-0.01em] text-ink">
              Title register
            </span>
            <span className="badge badge--accent">Specimen</span>
          </div>
          <span className="mono text-[10.5px] tabular-nums text-ink-2">
            rev {TITLE.revision}
          </span>
        </div>

        <div className="grid sm:grid-cols-2 sm:divide-x sm:divide-line">
          <Face name="Native record" runtime="native" rows={FACES.wasm} />
          <Face
            name="Market representation"
            runtime="Revive"
            rows={FACES.erc20}
            className="border-t border-line sm:border-t-0"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line bg-surface px-4 py-2.5">
          <span className="mono text-[10.5px] tabular-nums text-muted">
            title {TITLE.shortId}
          </span>
          <span className="mono text-[10.5px] tabular-nums text-muted">
            finalized block {TITLE.block}
          </span>
        </div>
      </div>

      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-2">
        Specimen. These are design constants, not a chain read. The console
        reads both runtimes over JSON-RPC.
      </p>
    </div>
  )
}
