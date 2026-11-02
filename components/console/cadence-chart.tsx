'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { median } from '@/lib/chain'
import { formatInt, slot as slotLabel } from '@/lib/format'

export type CadencePoint = { number: number; slot: number; timestamp: number }

const AXIS = {
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  fill: 'var(--color-ink-2)',
} as const

export function CadenceChart({
  data,
  error = null,
}: {
  data: CadencePoint[]
  error?: string | null
}) {
  const values = data.map((point) => point.slot)
  const middle = median(values.map((value) => value * 1000))

  if (data.length < 2) {
    return (
      <div className="flex min-h-[240px] flex-1 items-center justify-center rounded-[7px] border border-dashed border-line px-6">
        <p className="max-w-[34ch] text-center text-[12.5px] leading-5 text-muted">
          {error ?? 'Reading the finalized blocks. The chart needs two neighbours to measure a slot.'}
        </p>
      </div>
    )
  }

  // The guard above leaves at least two points, so every bound on this axis is
  // measured from the blocks that were read. No fallback value is drawn.
  const shortest = Math.min(...values)
  const longest = Math.max(...values)

  // A slot series is almost flat, so the axis is fitted to the data. A zero based
  // axis would draw one solid block and hide every difference.
  const low = shortest
  const high = longest
  const spread = high - low
  const pad = spread < 0.05 ? 0.3 : Math.max(0.12, spread * 0.35)
  const floor = Math.max(0, low - pad)
  const ceiling = high + pad
  const ticks = [floor, (floor + ceiling) / 2, ceiling]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-[240px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: -16 }}>
            <defs>
              <linearGradient id="cadence-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-ink-2)" stopOpacity={0.16} />
                <stop offset="100%" stopColor="var(--color-ink-2)" stopOpacity={0.01} />
              </linearGradient>
            </defs>

            <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="2 6" />

            <XAxis
              dataKey="number"
              tickLine={false}
              axisLine={{ stroke: 'var(--color-line-strong)' }}
              tickMargin={10}
              minTickGap={52}
              tick={AXIS}
              tickFormatter={(value: number) => `#${formatInt(value)}`}
            />
            <YAxis
              width={48}
              domain={[floor, ceiling]}
              ticks={ticks}
              tickLine={false}
              axisLine={false}
              tick={AXIS}
              tickFormatter={(value: number) => `${value.toFixed(1)}s`}
            />

            {middle === null ? null : (
              <ReferenceLine
                y={middle / 1000}
                stroke="var(--color-accent)"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            )}

            <Tooltip
              cursor={{ stroke: 'var(--color-ink-2)', strokeWidth: 1, strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (active !== true || payload === undefined || payload.length === 0) return null
                const point = payload[0]?.payload as CadencePoint | undefined
                if (point === undefined) return null

                return (
                  <div className="rounded-[7px] border border-line-strong bg-overlay px-2.5 py-2 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.9)]">
                    <p className="font-mono text-[11px] tabular-nums text-ink">
                      block #{formatInt(point.number)}
                    </p>
                    <p className="mt-1 font-mono text-[11px] tabular-nums text-ink-2">
                      slot {slotLabel(point.slot * 1000)}
                    </p>
                    <p className="font-mono text-[10.5px] tabular-nums text-muted">
                      {new Date(point.timestamp).toISOString().slice(11, 19)} UTC
                    </p>
                  </div>
                )
              }}
            />

            <Area
              dataKey="slot"
              type="linear"
              baseValue="dataMin"
              stroke="var(--color-ink-2)"
              strokeWidth={1.6}
              fill="url(#cadence-fill)"
              dot={{ r: 2, fill: 'var(--color-ink-2)', strokeWidth: 0 }}
              activeDot={{ r: 3, strokeWidth: 0, fill: 'var(--color-accent-bright)' }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5 border-t border-line pt-2.5 font-mono text-[10.5px] text-muted">
        <span>
          {formatInt(data.length)} blocks, #{formatInt(data[0]?.number ?? null)} to #
          {formatInt(data.at(-1)?.number ?? null)}
        </span>
        <span className="flex gap-4">
          <span>
            min <span className="text-ink">{slotLabel(shortest * 1000)}</span>
          </span>
          <span>
            med <span className="text-ink">{slotLabel(middle)}</span>
          </span>
          <span>
            max <span className="text-ink">{slotLabel(longest * 1000)}</span>
          </span>
        </span>
      </div>
    </div>
  )
}
