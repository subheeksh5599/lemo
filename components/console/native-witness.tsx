'use client'

import Link from 'next/link'
import { AlertTriangle, ArrowRight, Check, RefreshCw, ShieldCheck, X } from 'lucide-react'

import { ProofWalk } from '@/components/console/proof-walk'
import { Panel, Row, State } from '@/components/console/primitives'
import { useNativeWitness } from '@/hooks/use-proof'
import type { NativeWitness } from '@/lib/chain'
import { bytes, formatInt, hashShort, ms } from '@/lib/format'
import { cn } from '@/lib/utils'

function verdict(witness: NativeWitness) {
  const status = witness.verification.status

  if (status === 'valid') {
    return {
      tone: 'ok' as const,
      icon: Check,
      word: 'verified',
      line: witness.valueIsHead
        ? 'value is bound to the root and equals the finalized block number'
        : 'value is bound to the state root',
    }
  }

  if (status === 'absent') {
    return {
      tone: 'warn' as const,
      icon: AlertTriangle,
      word: 'absent',
      line: 'the proof reaches the key and the trie holds no value there',
    }
  }

  if (status === 'incomplete') {
    return {
      tone: 'warn' as const,
      icon: AlertTriangle,
      word: 'incomplete',
      line: 'the path is not fully covered by the nodes the node returned',
    }
  }

  return {
    tone: 'bad' as const,
    icon: X,
    word: status === 'root-mismatch' ? 'root mismatch' : 'invalid',
    line: witness.verification.message,
  }
}

function CheckLine({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <Check className="mt-[3px] size-3 shrink-0 text-ok" strokeWidth={2.2} aria-hidden="true" />
      ) : (
        <X className="mt-[3px] size-3 shrink-0 text-warn" strokeWidth={2.2} aria-hidden="true" />
      )}
      <span className={cn('text-[11.5px] leading-4', ok ? 'text-ink-2' : 'text-warn')}>
        {children}
      </span>
    </li>
  )
}

function WitnessBody({ witness, full }: { witness: NativeWitness; full: boolean }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="meta">proven value</p>
          <p className="mt-1.5 font-mono text-[26px] leading-none tracking-[-0.03em] tabular-nums text-ink">
            {witness.decoded === null ? 'absent' : formatInt(Number(witness.decoded.value))}
          </p>
          <p className="mt-1.5 font-mono text-[10.5px] text-muted">
            {witness.decoded === null
              ? 'no value at this key'
              : `${witness.decoded.reading} | ${witness.decoded.note}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="meta">block</p>
          <p className="mt-1.5 font-mono text-[13px] tabular-nums text-ink-2">
            #{formatInt(witness.blockNumber)}
          </p>
          <p className="mt-1 font-mono text-[10.5px] tabular-nums text-muted">
            {witness.proofNodes} nodes, {witness.nodes.length} steps
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
        <CheckLine ok={witness.verification.rootMatches}>
          the root node rehashes to the state root, blake2b-256
        </CheckLine>
        <CheckLine ok={witness.verification.ok}>
          the walk consumes the key nibble by nibble and ends on a value
        </CheckLine>
        <CheckLine ok={witness.storageMatches}>
          proven bytes equal state_getStorage at the same block
        </CheckLine>
      </ul>

      <div className="mt-3 border-t border-line pt-1">
        <Row
          label="State root"
          value={hashShort(witness.stateRoot, 10, 8)}
          title={witness.stateRoot}
          tone="muted"
        />
        <Row label="Value bytes" value={witness.valueBytes === 0 ? '-' : bytes(witness.valueBytes)} />
        <Row
          label="Proof size"
          value={`${bytes(witness.proofBytes)} in ${witness.proofNodes} nodes`}
          tone="muted"
        />
        {full ? (
          <>
            <Row
              label="Storage key"
              value={hashShort(witness.key, 12, 8)}
              title={witness.key}
              tone="muted"
            />
            <Row label="Proven hex" value={witness.provenValue ?? 'none'} tone="muted" />
            <Row label="Read" value={`${ms(witness.latencyMs)} at the finalized head`} tone="muted" />
          </>
        ) : null}
      </div>

      {full ? (
        <div className="mt-3 border-t border-line pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="meta">trie walk</p>
            <p className="font-mono text-[10px] text-muted">node, prefix, depth, hash</p>
          </div>
          <ProofWalk nodes={witness.nodes} />
        </div>
      ) : null}
    </>
  )
}

export function NativeWitnessPanel({
  variant = 'card',
  className,
}: {
  variant?: 'card' | 'full'
  className?: string
}) {
  const { data, error, reading, read } = useNativeWitness()
  const full = variant === 'full'

  const state = data === null ? null : verdict(data)
  const StatusIcon = state?.icon

  return (
    <Panel
      title={full ? 'Native witness' : 'Native witness'}
      hint={full ? 'System.Number at the finalized head' : 'System.Number'}
      className={className}
      aside={
        <>
          {state === null ? null : (
            <State tone={state.tone}>
              {StatusIcon === undefined ? null : (
                <StatusIcon className="size-3" strokeWidth={2.2} aria-hidden="true" />
              )}
              {state.word}
            </State>
          )}
          <button
            type="button"
            onClick={() => void read()}
            disabled={reading}
            aria-label="Read the witness again"
            title="Read the witness again"
            className="inline-flex size-7 items-center justify-center rounded-[5px] border border-transparent text-muted transition-colors duration-150 hover:border-line-strong hover:bg-raised hover:text-ink disabled:opacity-50"
          >
            <RefreshCw
              className={cn('size-3.5', reading && 'animate-spin')}
              strokeWidth={1.6}
              aria-hidden="true"
              style={reading ? { animationDuration: '1.1s' } : undefined}
            />
          </button>
        </>
      }
    >
      {error !== null ? (
        <p className="flex items-start gap-2 text-[12px] leading-5 text-bad">
          <X className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      ) : data === null ? (
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <ShieldCheck className="size-3.5 text-muted" strokeWidth={1.6} aria-hidden="true" />
          Reading a read proof and the storage value at the finalized head.
        </div>
      ) : (
        <WitnessBody witness={data} full={full} />
      )}

      {!full && data !== null ? (
        <Link
          href="/console/proofs"
          className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5 text-[11.5px] text-ink-2 transition-colors duration-150 hover:text-ink"
        >
          Open the trie walk
          <ArrowRight className="size-3.5 text-muted" strokeWidth={1.6} aria-hidden="true" />
        </Link>
      ) : null}
    </Panel>
  )
}
