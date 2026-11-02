'use client'

import { AlertTriangle, RefreshCw, X } from 'lucide-react'

import { Panel, Row, State } from '@/components/console/primitives'
import { useEvmProbe } from '@/hooks/use-proof'
import { formatInt, hashShort, ms } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * The EVM side of the same question. The endpoint answers the call itself, so
 * the panel shows the node's refusal verbatim and draws nothing in its place.
 */
export function EvmWitnessPanel({ className }: { className?: string }) {
  const { data, error, reading, read } = useEvmProbe()

  return (
    <Panel
      title="EVM account witness"
      hint="eth_getProof"
      className={className}
      aside={
        data === null ? null : (
          <State tone={data.supported ? 'ok' : 'warn'}>
            {data.supported ? null : (
              <AlertTriangle className="size-3" strokeWidth={2} aria-hidden="true" />
            )}
            {data.supported ? 'answered' : 'refused'}
          </State>
        )
      }
    >
      <div className="flex items-center justify-between gap-3 pb-2">
        <p className="font-mono text-[10.5px] leading-4 text-muted">
          account proof for the producer of the finalized block
        </p>
        <button
          type="button"
          onClick={() => void read()}
          disabled={reading}
          aria-label="Ask the endpoint again"
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[5px] border border-line px-3 font-mono text-[10px] text-muted transition-colors duration-150 hover:border-line-strong hover:text-ink disabled:opacity-50"
        >
          <RefreshCw
            className={cn('size-3', reading && 'animate-spin')}
            strokeWidth={1.8}
            aria-hidden="true"
            style={reading ? { animationDuration: '1.1s' } : undefined}
          />
          ask
        </button>
      </div>

      {error !== null ? (
        <p className="flex items-start gap-2 text-[12px] leading-5 text-bad">
          <X className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      ) : data === null ? (
        <p className="text-[12px] text-muted">Waiting for the endpoint to answer.</p>
      ) : data.supported ? (
        <>
          <Row label="Account" value={hashShort(data.address, 10, 8)} title={data.address} />
          <Row label="Finalized block" value={`#${formatInt(data.blockNumber)}`} />
          <Row label="Balance" value={`${data.balance} wei`} />
          <Row label="Nonce" value={formatInt(data.nonce)} tone="muted" />
          <Row label="Nodes" value={`${data.nodes} nodes, ${data.bytes} B`} tone="muted" />
          <Row label="Read" value={ms(data.latencyMs)} tone="muted" />
        </>
      ) : (
        <>
          <div className="rounded-[6px] border border-warn/30 bg-warn/5 px-2.5 py-2">
            <p className="font-mono text-[10px] text-warn">
              {data.method}
            </p>
            <p className="mt-1 font-mono text-[12px] leading-5 text-ink">{data.reason}</p>
          </div>

          <div className="mt-2">
            <Row
              label="Finalized block"
              value={data.blockNumber === null ? '-' : `#${formatInt(data.blockNumber)}`}
            />
            <Row
              label="Address asked"
              value={hashShort(data.address, 10, 8)}
              title={data.address}
              tone="muted"
            />
            <Row label="Read" value={ms(data.latencyMs)} tone="muted" />
          </div>

          <p className="mt-2.5 border-t border-line pt-2.5 text-[11.5px] leading-[1.55] text-muted">
            This endpoint does not implement account proofs. The call was made, the node
            refused it, and no EVM witness is drawn in its place.
          </p>
        </>
      )}
    </Panel>
  )
}
