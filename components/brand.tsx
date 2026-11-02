type MarkProps = {
  className?: string
}

/**
 * The mark is two brackets facing a shared spine: the native record, the market
 * representation, and the title between them.
 */
export function LemoMark({ className }: MarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={className}
      fill="none"
    >
      <path
        d="M4.5 6.5h7.5v19H4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M27.5 6.5H20v19h7.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M16 3.5v25" stroke="currentColor" strokeWidth="1.1" opacity="0.55" />
      <circle cx="16" cy="16" r="2.2" fill="currentColor" />
    </svg>
  )
}

/**
 * A circular revision stamp. It carries a real revision figure when one is
 * passed; otherwise it stays a mark without inventing a version.
 */
export function RevisionSeal({
  revision = '07',
  label = 'LEMO · TITLE',
  className,
}: {
  revision?: string
  label?: string
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
      className={className}
      fill="none"
    >
      <defs>
        <path
          id="lemo-seal-arc"
          d="M 60 60 m -44 0 a 44 44 0 1 1 88 0"
        />
      </defs>
      <circle cx="60" cy="60" r="54" stroke="currentColor" strokeWidth="1.2" opacity="0.85" />
      <circle cx="60" cy="60" r="48" stroke="currentColor" strokeWidth="0.6" opacity="0.45" />
      <circle
        cx="60"
        cy="60"
        r="33"
        stroke="currentColor"
        strokeWidth="0.6"
        strokeDasharray="2 4"
        opacity="0.5"
      />
      <text
        fill="currentColor"
        fontFamily="'JetBrains Mono Variable', monospace"
        fontSize="6.6"
        letterSpacing="1.7"
        opacity="0.72"
      >
        <textPath href="#lemo-seal-arc" startOffset="50%" textAnchor="middle">
          {label}
        </textPath>
      </text>
      <text
        x="60"
        y="64"
        textAnchor="middle"
        fill="currentColor"
        fontFamily="'Geist Variable', sans-serif"
        fontSize="25"
        fontWeight="480"
        letterSpacing="-1"
      >
        {revision}
      </text>
      <text
        x="60"
        y="77"
        textAnchor="middle"
        fill="currentColor"
        fontFamily="'JetBrains Mono Variable', monospace"
        fontSize="5.2"
        letterSpacing="1.8"
        opacity="0.7"
      >
        REVISION
      </text>
    </svg>
  )
}
