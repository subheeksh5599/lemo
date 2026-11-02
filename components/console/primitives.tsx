import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** A bordered section with a header strip. Borders carry the hierarchy. */
export function Panel({
  title,
  hint,
  aside,
  children,
  className,
  bodyClassName,
  flush = false,
}: {
  title: string
  hint?: string
  aside?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  flush?: boolean
}) {
  return (
    <section
      className={cn(
        'min-w-0 overflow-hidden rounded-[10px] border border-line bg-surface shadow-[inset_0_1px_0_0_rgba(255,255,255,0.035)]',
        className,
      )}
    >
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-3.5 py-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <h2 className="text-[12.5px] font-medium tracking-[-0.01em] text-ink">{title}</h2>
          {hint === undefined ? null : <span className="meta text-ink-2/70">{hint}</span>}
        </div>
        {aside === undefined ? null : <div className="flex shrink-0 items-center gap-2">{aside}</div>}
      </header>
      <div className={cn(flush ? '' : 'p-3.5', bodyClassName)}>{children}</div>
    </section>
  )
}

/** A label / value row. Values are mono and tabular, right aligned. */
export function Row({
  label,
  value,
  title,
  tone = 'default',
  mono = true,
}: {
  label: string
  value: ReactNode
  title?: string
  tone?: 'default' | 'muted' | 'ok' | 'warn' | 'bad' | 'accent'
  mono?: boolean
}) {
  const color =
    tone === 'ok'
      ? 'text-ok'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'bad'
          ? 'text-bad'
          : tone === 'accent'
            ? 'text-accent-bright'
            : tone === 'muted'
              ? 'text-muted'
              : 'text-ink'

  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 border-b border-line py-2 last:border-b-0">
      <span className="shrink-0 text-[12px] text-muted">{label}</span>
      <span
        title={title}
        className={cn(
          'min-w-0 truncate text-right text-[12px] tabular-nums',
          mono && 'font-mono',
          color,
        )}
      >
        {value}
      </span>
    </div>
  )
}

/** A figure with its label, used inside panels and the KPI band. */
export function Figure({
  label,
  value,
  note,
  tone = 'default',
  size = 'md',
}: {
  label: string
  value: ReactNode
  note?: ReactNode
  tone?: 'default' | 'accent' | 'ok' | 'warn' | 'bad' | 'muted'
  size?: 'md' | 'lg'
}) {
  const color =
    tone === 'accent'
      ? 'text-accent-bright'
      : tone === 'ok'
        ? 'text-ok'
        : tone === 'warn'
          ? 'text-warn'
          : tone === 'bad'
            ? 'text-bad'
            : tone === 'muted'
              ? 'text-ink-2'
              : 'text-ink'

  return (
    <div className="min-w-0">
      <p className="meta truncate text-ink-2/80">{label}</p>
      <p
        className={cn(
          'mt-1.5 font-mono tabular-nums tracking-[-0.03em]',
          size === 'lg' ? 'text-[28px] leading-none' : 'text-[22px] leading-none',
          color,
        )}
      >
        {value}
      </p>
      {note === undefined ? null : (
        <p className="mt-1.5 truncate text-[11.5px] leading-4 text-muted">{note}</p>
      )}
    </div>
  )
}

/**
 * A verification state as a word plus an icon. No filled pill: the tint and the
 * icon carry the state, the text says exactly what was checked.
 */
export function State({
  tone,
  children,
  className,
}: {
  tone: 'ok' | 'warn' | 'bad' | 'idle' | 'accent'
  children: ReactNode
  className?: string
}) {
  const color =
    tone === 'ok'
      ? 'text-ok'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'bad'
          ? 'text-bad'
          : tone === 'accent'
            ? 'text-accent-bright'
            : 'text-muted'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-mono text-[10.5px] tabular-nums',
        color,
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className="h-3 rounded-[3px] bg-raised"
        />
      ))}
    </div>
  )
}

/** A designed empty or failed state, never a blank panel. */
export function Notice({
  tone = 'idle',
  title,
  children,
}: {
  tone?: 'idle' | 'bad' | 'warn'
  title: string
  children?: ReactNode
}) {
  const border =
    tone === 'bad' ? 'border-bad/35' : tone === 'warn' ? 'border-warn/35' : 'border-line'
  const dot =
    tone === 'bad' ? 'bg-bad' : tone === 'warn' ? 'bg-warn' : 'bg-faint'

  return (
    <div className={cn('flex items-start gap-2.5 rounded-[7px] border px-3 py-2.5', border)}>
      <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', dot)} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[12.5px] leading-5 text-ink">{title}</p>
        {children === undefined ? null : (
          <div className="mt-1 text-[12px] leading-5 text-muted">{children}</div>
        )}
      </div>
    </div>
  )
}
