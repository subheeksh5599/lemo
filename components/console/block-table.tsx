'use client'

import type { NativeBlock } from '@/lib/chain'
import { CopyButton } from '@/components/console/copy-button'
import { formatInt, hashShort, slot } from '@/lib/format'

export function BlockTable({ blocks, limit = 10 }: { blocks: NativeBlock[]; limit?: number }) {
  const rows = [...blocks].reverse().slice(0, limit)

  if (rows.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center px-6">
        <p className="max-w-[36ch] text-center text-[12.5px] leading-5 text-muted">
          No block has been read yet. The table fills from the finalized head backwards.
        </p>
      </div>
    )
  }

  return (
    <div className="-mx-3.5">
      <table className="w-full border-collapse">
        <caption className="sr-only">Recent finalized blocks on the native runtime</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="meta px-3.5 py-2 text-left font-medium text-ink-2/80">
              Block
            </th>
            <th scope="col" className="meta hidden px-3 py-2 text-left font-medium text-ink-2/80 sm:table-cell">
              Hash
            </th>
            <th scope="col" className="meta px-3 py-2 text-right font-medium text-ink-2/80">
              Finalized
            </th>
            <th scope="col" className="meta px-3 py-2 text-right font-medium text-ink-2/80">
              Slot
            </th>
            <th scope="col" className="meta hidden px-3.5 py-2 text-right font-medium text-ink-2/80 md:table-cell">
              Extrinsics
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((block, index) => (
            <tr
              key={block.number}
              className="group border-b border-line/70 transition-colors duration-100 last:border-b-0 hover:bg-raised/45"
            >
              <td className="whitespace-nowrap px-3.5 py-1.5">
                <span className="font-mono text-[12px] tabular-nums text-ink">
                  #{formatInt(block.number)}
                </span>
                {index === 0 ? (
                  <span className="ml-2 font-mono text-[9.5px] text-accent">
                    head
                  </span>
                ) : null}
              </td>
              <td className="hidden max-w-0 px-3 py-1.5 sm:table-cell">
                <span className="flex items-center gap-1.5">
                  <span
                    className="truncate font-mono text-[11px] text-ink-2"
                    title={block.hash}
                  >
                    {hashShort(block.hash, 10, 6)}
                  </span>
                  <CopyButton
                    value={block.hash}
                    label={`block ${block.number} hash`}
                    className="opacity-60 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
                  />
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-[11.5px] tabular-nums text-ink-2">
                {new Date(block.timestamp).toISOString().slice(11, 19)}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-[11.5px] tabular-nums text-muted">
                {slot(block.intervalMs)}
              </td>
              <td className="hidden whitespace-nowrap px-3.5 py-1.5 text-right font-mono text-[11.5px] tabular-nums text-muted md:table-cell">
                {formatInt(block.extrinsics)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 px-3.5 font-mono text-[10.5px] text-muted">
        times in utc, slot measured between neighbours
      </p>
    </div>
  )
}
