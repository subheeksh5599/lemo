'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

import { cn } from '@/lib/utils'

/** Copies the exact value that is on screen. Used for hashes and storage keys. */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string
  label: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          if (timer.current !== null) window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => setCopied(false), 1400)
        } catch {
          setCopied(false)
        }
      }}
      className={cn(
        'inline-flex size-5 items-center justify-center rounded-[4px] text-muted transition-colors duration-150 hover:bg-raised hover:text-ink',
        className,
      )}
    >
      {copied ? (
        <Check className="size-3 text-ok" strokeWidth={2} aria-hidden="true" />
      ) : (
        <Copy className="size-3" strokeWidth={1.6} aria-hidden="true" />
      )}
    </button>
  )
}
