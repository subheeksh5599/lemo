import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type Tone = 'default' | 'muted' | 'ok' | 'warn' | 'bad' | 'accent'

const TONE_TEXT: Record<Tone, string> = {
  default: 'text-ink',
  muted: 'text-muted',
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  accent: 'text-accent-bright',
}

/**
 * The one page header in the console: a title, one line of live context, and
 * at most one action. Every console page opens with it so titles share a size.
 */
export function PageHeader({
  title,
  meta,
  action,
}: {
  title: ReactNode
  meta?: ReactNode
  action?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="max-w-none text-[22px] font-medium leading-tight tracking-[-0.02em] text-ink">
          {title}
        </h1>
        {meta === undefined ? null : (
          <p className="mt-1 max-w-[88ch] font-mono text-[12px] leading-5 tabular-nums text-muted">
            {meta}
          </p>
        )}
      </div>
      {action === undefined ? null : <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </header>
  )
}

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
      className={cn('min-w-0 overflow-hidden rounded-md border border-line bg-surface', className)}
    >
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h2 className="max-w-none text-[14px] font-medium tracking-[-0.01em] text-ink">{title}</h2>
          {hint === undefined ? null : <span className="meta">{hint}</span>}
        </div>
        {aside === undefined ? null : <div className="flex shrink-0 items-center gap-2">{aside}</div>}
      </header>
      <div className={cn(flush ? '' : 'p-4', bodyClassName)}>{children}</div>
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
  tone?: Tone
  mono?: boolean
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 border-b border-line py-2 last:border-b-0">
      <span className="shrink-0 text-[13px] text-muted">{label}</span>
      <span
        title={title}
        className={cn(
          'min-w-0 truncate text-right tabular-nums',
          mono ? 'font-mono text-[12px]' : 'text-[13px]',
          TONE_TEXT[tone],
        )}
      >
        {value}
      </span>
    </div>
  )
}

/** A figure with its label. Inside a FigureBand it sits on a shared hairline grid. */
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
  tone?: Tone
  size?: 'md' | 'lg'
}) {
  return (
    <div className="min-w-0">
      <p className="meta truncate">{label}</p>
      <div
        className={cn(
          'mt-2 truncate font-mono leading-none tabular-nums tracking-[-0.02em]',
          size === 'lg' ? 'text-[28px]' : 'text-[24px]',
          tone === 'muted' ? 'text-ink-2' : TONE_TEXT[tone],
        )}
      >
        {value}
      </div>
      {note === undefined ? null : (
        <p className="mt-2 line-clamp-2 text-[12px] leading-4 text-muted">{note}</p>
      )}
    </div>
  )
}

/**
 * The headline figures of a page, in one bordered band divided by hairlines.
 * Pages use this instead of loose figures or a row of separate cards.
 */
export function FigureBand({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section className="overflow-hidden rounded-md border border-line bg-line">
      <div
        className={cn(
          'grid gap-px *:bg-surface *:px-4 *:py-4',
          className ?? 'grid-cols-2 lg:grid-cols-4',
        )}
      >
        {children}
      </div>
    </section>
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
        'inline-flex items-center gap-1.5 font-mono text-[12px] tabular-nums',
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
        <div key={index} className="h-3 rounded-xs bg-raised" />
      ))}
    </div>
  )
}

/**
 * The console's one status component. Boundaries (what a page does not prove),
 * failures and empty states all render through it, so each reads the same and
 * each page states a given boundary once.
 */
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
  const dot = tone === 'bad' ? 'bg-bad' : tone === 'warn' ? 'bg-warn' : 'bg-faint'

  return (
    <div className={cn('flex items-start gap-3 rounded-sm border bg-surface px-4 py-3', border)}>
      <span className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', dot)} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[13px] font-medium leading-5 text-ink">{title}</p>
        {children === undefined ? null : (
          <div className="mt-1 max-w-[92ch] text-[13px] leading-5 text-muted">{children}</div>
        )}
      </div>
    </div>
  )
}
