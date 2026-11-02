'use client'

import { AlertTriangle, Check, RefreshCw, X } from 'lucide-react'

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
      title="EVM proof"
      hint="eth_getProof"
      className={className}
      aside={
        data === null ? null : (
          <State tone={data.supported ? 'ok' : 'warn'}>
            {data.supported ? (
              <Check className="size-4" strokeWidth={1.6} aria-hidden="true" />
            ) : (
              <AlertTriangle className="size-4" strokeWidth={1.6} aria-hidden="true" />
            )}
            {data.supported ? 'answered' : 'refused'}
          </State>
        )
      }
    >
      <div className="flex items-center justify-between gap-3 pb-3">
        <p className="font-mono text-[11px] leading-5 text-muted">
          Account proof for the producer of the finalized block
        </p>
        <button
          type="button"
          onClick={() => void read()}
          disabled={reading}
          aria-label="Ask the endpoint again"
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-[8px] border border-line px-3 font-mono text-[10.5px] text-muted transition-colors duration-150 hover:border-line-strong hover:text-ink disabled:opacity-50"
        >
          <RefreshCw
            className={cn('size-4', reading && 'animate-spin')}
            strokeWidth={1.6}
            aria-hidden="true"
            style={reading ? { animationDuration: '1.1s' } : undefined}
          />
          Ask again
        </button>
      </div>

      {error !== null ? (
        <p className="flex items-start gap-2.5 text-[12.5px] leading-5 text-bad">
          <X className="mt-0.5 size-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
          {error}
        </p>
      ) : data === null ? (
        <p className="text-[12.5px] text-muted">Waiting for the endpoint to answer.</p>
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
          <div className="rounded-[10px] border border-warn/35 bg-warn/[0.05] px-4 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] font-medium text-ink">Endpoint refused the call</p>
              <State tone="warn">
                <AlertTriangle className="size-4" strokeWidth={1.6} aria-hidden="true" />
                no proof
              </State>
            </div>
            <p className="mt-2 font-mono text-[11px] text-warn">{data.method}</p>
            <p className="mt-1 font-mono text-[12.5px] leading-5 text-ink-2">{data.reason}</p>
          </div>

          <div className="mt-3">
            <Row
              label="Finalized block"
              value={data.blockNumber === null ? '-' : `#${formatInt(data.blockNumber)}`}
            />
            <Row
              label="Address asked"
              value={hashShort(data.address, 10, 8)}
              title={data.address ?? undefined}
              tone="muted"
            />
            <Row label="Read" value={ms(data.latencyMs)} tone="muted" />
          </div>

          <p className="mt-3 border-t border-line pt-3 text-[12px] leading-5 text-muted">
            The call was made and the endpoint refused it. No EVM proof is drawn in its
            place, and no address is substituted.
          </p>
        </>
      )}
    </Panel>
  )
}
