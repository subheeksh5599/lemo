export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  return value.toLocaleString('en-US')
}

export function shortHash(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

export function seconds(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  return `${(value / 1000).toFixed(2)} s`
}

export function relativeTime(timestamp: number | null | undefined): string {
  if (timestamp === null || timestamp === undefined) return 'not read yet'
  const delta = Math.max(0, Date.now() - timestamp)
  if (delta < 4_000) return 'just now'
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`
  return `${Math.round(delta / 3_600_000)}h ago`
}

export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  if (value < 1024) return `${value} B`
  return `${(value / 1024).toFixed(1)} kB`
}

export function clockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  return `${(value * 100).toFixed(1)}%`
}

export function ms(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  if (value < 1000) return `${Math.round(value)} ms`
  return `${(value / 1000).toFixed(2)} s`
}

/** Milliseconds as a slot length, always two decimals so columns line up. */
export function slot(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  return `${(value / 1000).toFixed(2)}s`
}

export function clockUtc(timestamp: number): string {
  return `${new Date(timestamp).toISOString().slice(11, 19)} UTC`
}

export function dateUtc(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

/** A hash with its 0x kept, so a shortened reading still reads as hex. */
export function hashShort(value: string | null | undefined, head = 8, tail = 6): string {
  if (value === null || value === undefined) return '-'
  if (value.length <= head + tail + 3) return value
  return `${value.slice(0, head + 2)}\u2026${value.slice(-tail)}`
}
