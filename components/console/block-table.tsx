'use client'

import type { NativeBlock } from '@/lib/chain'
import { CopyButton } from '@/components/console/copy-button'
import { formatInt, hashShort, slot } from '@/lib/format'

export function BlockTable({ blocks, limit = 10 }: { blocks: NativeBlock[]; limit?: number }) {
  const rows = [...blocks].reverse().slice(0, limit)

  if (rows.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center px-6">
        <p className="max-w-[36ch] text-center text-[13px] leading-5 text-muted">
          No block has been read yet. The table fills from the finalized head backwards.
        </p>
      </div>
    )
  }

  return (
    <div className="-mx-4">
      <table className="w-full border-collapse">
        <caption className="sr-only">Recent finalized blocks on the native runtime</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="meta px-4 py-2 text-left font-medium text-muted">
              Block
            </th>
            <th scope="col" className="meta hidden px-3 py-2 text-left font-medium text-muted sm:table-cell">
              Hash
            </th>
            <th scope="col" className="meta px-3 py-2 text-right font-medium text-muted">
              Time
            </th>
            <th scope="col" className="meta py-2 pr-4 text-right font-medium text-muted">
              Slot
            </th>
            <th scope="col" className="meta hidden py-2 pr-4 text-right font-medium text-muted md:table-cell">
              Events
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.number}
              className="border-b border-line/60 last:border-b-0 hover:bg-raised"
            >
              <td className="py-2 pl-4 pr-2">
                <span className="font-mono text-[13px] tabular-nums text-ink">
                  #{formatInt(row.number)}
                </span>
              </td>
              <td className="hidden max-w-0 px-3 py-2 sm:table-cell">
                <span className="flex items-center gap-2">
                  <span
                    className="truncate font-mono text-[12px] text-ink-2"
                    title={row.hash}
                  >
                    {hashShort(row.hash, 10, 6)}
                  </span>
                  <CopyButton
                    value={row.hash}
                    label={`block ${row.number} hash`}
                    className="opacity-70 hover:opacity-100"
                  />
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-[12px] tabular-nums text-ink-2">
                {new Date(row.timestamp).toISOString().slice(11, 19)}
              </td>
              <td className="whitespace-nowrap py-2 pr-4 text-right font-mono text-[12px] tabular-nums text-muted">
                {slot(row.intervalMs)}
              </td>
              <td className="hidden whitespace-nowrap py-2 pr-4 text-right font-mono text-[12px] tabular-nums text-muted md:table-cell">
                {formatInt(row.extrinsics)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 px-4 font-mono text-[11px] text-muted">
        Times in UTC. Slot is the time between neighbours.
      </p>
    </div>
  )
}
