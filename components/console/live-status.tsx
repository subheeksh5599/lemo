'use client'

import { RefreshCw } from 'lucide-react'

import { useConsole } from '@/components/console/console-provider'
import { useNow } from '@/hooks/use-console-data'
import { cn } from '@/lib/utils'

const WORD = {
  reading: 'reading',
  live: 'live',
  stale: 'stale',
  down: 'unreachable',
} as const

const COLOR = {
  reading: 'text-muted',
  live: 'text-ok',
  stale: 'text-warn',
  down: 'text-bad',
} as const

/**
 * The console's own liveness, from the last completed read. The visible text is
 * compact and the live region carries the full sentence for a screen reader.
 */
export function LiveStatus() {
  const { status, updatedAt, error } = useConsole()
  const now = useNow(1_000)

  const age = updatedAt === null ? null : Math.max(0, now - updatedAt)
  const ago =
    age === null
      ? null
      : age < 1_500
        ? 'now'
        : age < 60_000
          ? `${Math.round(age / 1000)}s ago`
          : age < 3_600_000
            ? `${Math.round(age / 60_000)}m ago`
            : `${Math.round(age / 3_600_000)}h ago`

  return (
    <span className="flex items-center gap-2" role="status" aria-live="polite" aria-atomic="true">
      <span
        aria-hidden="true"
        className={cn(
          'size-[6px] shrink-0 rounded-full',
          status === 'live' && 'bg-ok',
          status === 'stale' && 'bg-warn',
          status === 'down' && 'bg-bad',
          status === 'reading' && 'animate-pulse bg-faint',
        )}
      />
      <span className={cn('font-mono text-[10.5px] uppercase tracking-[0.12em]', COLOR[status])}>
        {WORD[status]}
      </span>
      {ago === null ? null : (
        <span className="font-mono text-[11px] tabular-nums text-muted">{ago}</span>
      )}
      <span className="sr-only">
        {updatedAt === null
          ? 'No reading from the node yet.'
          : `Chain ${WORD[status]}, last reading ${ago}.${
              error === null ? '' : ` Last error: ${error}`
            }`}
      </span>
    </span>
  )
}

export function RefreshButton({ className }: { className?: string }) {
  const { refresh, refreshing, reading } = useConsole()
  const busy = refreshing || reading

  return (
    <button
      type="button"
      onClick={() => void refresh()}
      disabled={busy}
      aria-label={busy ? 'Refreshing readings' : 'Refresh every reading on this page'}
      title={busy ? 'Refreshing' : 'Refresh'}
      className={cn(
        'inline-flex size-[30px] items-center justify-center rounded-[6px] border border-transparent text-muted transition-colors duration-150 hover:border-line-strong hover:bg-raised hover:text-ink disabled:opacity-50',
        className,
      )}
    >
      <RefreshCw
        className={cn('size-[14px]', busy && 'animate-spin')}
        strokeWidth={1.6}
        aria-hidden="true"
        style={busy ? { animationDuration: '1.1s' } : undefined}
      />
    </button>
  )
}
