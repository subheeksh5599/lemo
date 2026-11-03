import type { ReactNode } from 'react'

/**
 * One tooltip for the whole app. It is attached to the control, opens above
 * the trigger on hover or focus, and carries two or three words.
 */
export function Tooltip({
  label,
  children,
  side = 'top',
}: {
  label: string
  children: ReactNode
  side?: 'top' | 'bottom'
}) {
  return (
    <span className="group/tooltip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-xs border border-line-strong bg-raised px-2 py-1 font-mono text-[11px] text-ink opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-opacity duration-120 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100 ${
          side === 'top' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'
        }`}
      >
        {label}
      </span>
    </span>
  )
}
