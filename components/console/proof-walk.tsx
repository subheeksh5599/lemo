import { CopyButton } from '@/components/console/copy-button'
import type { ProofNodeReading } from '@/lib/chain'
import { hashShort } from '@/lib/format'

const KIND_LABEL: Record<string, string> = {
  leaf: 'leaf',
  branch: 'branch',
  'branch-with-value': 'branch + value',
  'hashed-leaf': 'leaf, hashed value',
  'hashed-branch': 'branch, hashed value',
  empty: 'empty',
}

/**
 * The path the verifier walked, one line per node: kind, how the node was
 * reached, its byte size, its depth, its hash and the nibbles it carried.
 */
export function ProofWalk({ nodes }: { nodes: ProofNodeReading[] }) {
  if (nodes.length === 0) {
    return (
      <p className="py-2 text-[11.5px] leading-4 text-muted">
        No node was walked. The proof did not start at the state root.
      </p>
    )
  }

  return (
    <ol className="mt-1.5">
      {nodes.map((node, index) => (
        <li key={`${node.hash}-${index}`} className="border-b border-line/60 py-2 last:border-b-0">
          <div className="flex items-baseline gap-2.5">
            <span className="w-4 shrink-0 font-mono text-[10px] tabular-nums text-muted">
              {index + 1}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-ink-2">
              {KIND_LABEL[node.kind] ?? node.kind}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-muted">
              {node.via}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[10.5px] tabular-nums text-muted">
              {node.bytes} B
            </span>
            <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted">
              depth {node.depth}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1 pl-[26px]">
            <span className="truncate font-mono text-[10.5px] text-ink-2" title={node.hash}>
              {hashShort(node.hash, 12, 8)}
            </span>
            <CopyButton value={node.hash} label="node hash" />
            <span className="ml-auto shrink-0 truncate pl-3 font-mono text-[10px] text-muted">
              {node.nibbles === '' ? 'no prefix' : node.nibbles}
            </span>
          </div>
        </li>
      ))}
    </ol>
  )
}
