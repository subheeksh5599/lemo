import { ArrowUpRight } from 'lucide-react'

import { cn } from '@/lib/utils'

/** An outbound link to the Portaldot V3 scanner; renders nothing without a URL. */
export function ScannerLink({
  href,
  label = 'scanner',
  className,
}: {
  href: string | null
  label?: string
  className?: string
}) {
  if (href === null) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={`Open on the Portaldot V3 scanner: ${href}`}
      className={cn(
        'inline-flex items-center gap-0.5 font-mono text-[11px] text-muted underline decoration-line underline-offset-4 transition-colors duration-150 hover:text-ink',
        className,
      )}
    >
      {label}
      <ArrowUpRight className="size-3" strokeWidth={1.8} aria-hidden="true" />
    </a>
  )
}
