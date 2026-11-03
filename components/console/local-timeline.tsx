'use client'

import type { ReactNode } from 'react'
import { Check, X } from 'lucide-react'

import { CopyButton } from '@/components/console/copy-button'
import { Panel, Row, State } from '@/components/console/primitives'
import { ProofWalk } from '@/components/console/proof-walk'
import { formatInt, hashShort } from '@/lib/format'
import type { CaptureReport, EvmStep, NativeStep } from '@/lib/local-e2e'
import { cn } from '@/lib/utils'

/** A hash, middle truncated, full value in the title, with the one copy control. */
export function Hash({ value, label, head = 10, tail = 8 }: { value: string; label: string; head?: number; tail?: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span title={value}>{hashShort(value, head, tail)}</span>
      <CopyButton value={value} label={label} />
    </span>
  )
}

/** A chapter of the run: numbered, titled, one sentence of what it shows. */
export function Chapter({
  id,
  index,
  title,
  lede,
  children,
}: {
  id: string
  index: number
  title: string
  lede: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[12px] tabular-nums text-muted">{String(index).padStart(2, '0')}</span>
        <div className="min-w-0">
          <h2 className="max-w-none text-[14px] font-medium tracking-[-0.01em] text-ink">{title}</h2>
          <p className="mt-0.5 max-w-[92ch] text-[13px] leading-5 text-muted">{lede}</p>
        </div>
      </div>
      <div className="space-y-3 pl-0 sm:pl-7">{children}</div>
    </section>
  )
}

type StepTone = 'ok' | 'bad'

function StepFrame({
  side,
  title,
  tone,
  word,
  children,
  note,
}: {
  side: 'native' | 'anvil'
  title: string
  tone: StepTone
  word: string
  children: ReactNode
  note?: ReactNode
}) {
  return (
    <li
      className={cn(
        'rounded-md border bg-surface px-4 py-3',
        tone === 'bad' ? 'border-bad/35' : 'border-line',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="shrink-0 font-mono text-[11px] text-muted">{side}</span>
          <span className="min-w-0 truncate font-mono text-[13px] text-ink">{title}</span>
        </div>
        <State tone={tone}>
          {tone === 'ok' ? (
            <Check className="size-3" strokeWidth={2} aria-hidden="true" />
          ) : (
            <X className="size-3" strokeWidth={2} aria-hidden="true" />
          )}
          {word}
        </State>
      </div>
      <div className="mt-2 grid gap-x-6 sm:grid-cols-2">{children}</div>
      {note === undefined ? null : (
        <p className="mt-2 max-w-[92ch] text-[12px] leading-5 text-muted">{note}</p>
      )}
    </li>
  )
}

export function StepList({ children }: { children: ReactNode }) {
  return <ol className="space-y-2">{children}</ol>
}

/** One native extrinsic: hash, block, index, outcome and the exact dispatch error. */
export function NativeStepRow({
  step,
  title,
  note,
  expectRefusal = false,
}: {
  step: NativeStep
  title?: string
  note?: ReactNode
  expectRefusal?: boolean
}) {
  const failed = step.outcome === 'failed'
  const error = step.error === null ? null : `${step.error.pallet ?? ''}.${step.error.error}`
  return (
    <StepFrame
      side="native"
      title={title ?? step.label}
      tone={failed ? 'bad' : 'ok'}
      word={failed ? (expectRefusal ? 'refused' : 'failed') : 'in block'}
      note={note}
    >
      <Row label="Extrinsic hash" value={<Hash value={step.extrinsicHash} label="extrinsic hash" />} />
      <Row
        label="Block"
        value={<span title={step.blockHash}>{`#${formatInt(step.blockNumber)}, extrinsic ${step.extrinsicIndex}`}</span>}
      />
      {error === null ? (
        <Row
          label="Events"
          value={step.events
            .map((e) => e.name)
            .filter((n) => !n.startsWith('balances.'))
            .join(', ')}
          tone="muted"
        />
      ) : (
        <Row label="Dispatch error" value={error} tone="bad" />
      )}
      <Row label="Signer" value={<span title={step.signer}>{hashShort(step.signer, 6, 6)}</span>} tone="muted" />
    </StepFrame>
  )
}

/** One anvil transaction: hash, block, status and the decoded custom error when reverted. */
export function EvmStepRow({
  step,
  title,
  note,
  extra,
}: {
  step: EvmStep
  title?: string
  note?: ReactNode
  extra?: ReactNode
}) {
  const reverted = step.status === 'reverted'
  return (
    <StepFrame
      side="anvil"
      title={title ?? step.label}
      tone={reverted ? 'bad' : 'ok'}
      word={reverted ? 'reverted' : 'mined'}
      note={note}
    >
      <Row label="Tx hash" value={<Hash value={step.txHash} label="transaction hash" />} />
      <Row label="Block" value={`#${formatInt(step.blockNumber)}, gas ${formatInt(step.gasUsed)}`} />
      {reverted && step.revert !== null ? (
        <Row label="Revert" value={step.revert.error} title={step.revert.selector ?? undefined} tone="bad" />
      ) : step.contractAddress !== null ? (
        <Row label="Contract" value={<Hash value={step.contractAddress} label="contract address" />} />
      ) : (
        <Row label="From" value={<span title={step.from}>{hashShort(step.from, 6, 6)}</span>} tone="muted" />
      )}
      {extra}
    </StepFrame>
  )
}

function CheckLine({ ok, label, detail }: { ok: boolean; label: string; detail: ReactNode }) {
  const Icon = ok ? Check : X
  return (
    <li className="flex items-start gap-2 border-b border-line/60 py-2 last:border-b-0">
      <Icon
        className={cn('mt-[3px] size-3.5 shrink-0', ok ? 'text-ok' : 'text-bad')}
        strokeWidth={2.1}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className={cn('text-[13px] leading-5', ok ? 'text-ink-2' : 'text-bad')}>{label}</p>
        <div className="mt-0.5 break-words font-mono text-[11px] leading-4 text-muted">{detail}</div>
      </div>
    </li>
  )
}

/**
 * The finalized capture, re-verified in this browser: header bytes to block
 * hash and state root, GRANDPA precommit signatures, then the trie walk.
 */
export function CaptureCheck({
  report,
  devAuthority,
  walkOpen = false,
  children,
}: {
  report: CaptureReport | null
  devAuthority: string
  walkOpen?: boolean
  children?: ReactNode
}) {
  if (report === null) {
    return (
      <Panel title="Finalized capture" hint="verifying in this browser">
        <p className="text-[13px] text-muted">Running the checks.</p>
      </Panel>
    )
  }
  const { capture, header, grandpa, proof } = report
  const vote = grandpa.precommits[0]

  return (
    <Panel
      title={`Finalized block #${formatInt(capture.header.number)}`}
      hint={capture.label}
      aside={
        <State tone={report.ok ? 'ok' : 'bad'}>
          {report.ok ? 'verified in this browser' : 'a check failed'}
        </State>
      }
    >
      <div className="grid gap-x-6 sm:grid-cols-2">
        <Row label="Block hash" value={<Hash value={capture.header.hash} label="block hash" />} />
        <Row label="State root" value={<Hash value={capture.header.stateRoot} label="state root" />} tone="accent" />
        <Row label="GRANDPA round / set" value={`${grandpa.round} / ${grandpa.setId}`} />
        <Row label="Justification" value={capture.justification.source} tone="muted" />
      </div>

      <ul className="mt-3 border-t border-line pt-1">
        <CheckLine
          ok={header.ok}
          label="Header bytes hash to the justified block, and carry this state root"
          detail={
            <>
              blake2_256(header, {formatInt((capture.header.encoded.length - 2) / 2)} B) ={' '}
              {hashShort(header.computedHash, 10, 8)}; number #{header.numberFromBytes}; state root read at byte
              offset {header.numberFromBytes < 64 ? 33 : header.numberFromBytes < 16384 ? 34 : 36}
            </>
          }
        />
        <CheckLine
          ok={grandpa.ok}
          label={`GRANDPA precommit signed by the dev authority (${grandpa.signed} of ${capture.authorities.length} authority, weight 1)`}
          detail={
            vote === undefined ? (
              'no precommit in the justification'
            ) : (
              <>
                ed25519Verify(0x01 ++ target ++ number LE ++ round LE ++ set_id LE) by{' '}
                {hashShort(vote.id, 8, 6)}
                {vote.isDevAuthority ? ' (//Alice ed25519)' : ' (not the dev authority)'}:{' '}
                {vote.signatureOk ? 'valid' : 'invalid'}; commit target{' '}
                {grandpa.commitTargetsBlock ? 'is this block' : 'is a different block'}; dev authority key{' '}
                {hashShort(devAuthority, 8, 6)}
              </>
            )
          }
        />
        <CheckLine
          ok={report.storageOk}
          label={
            report.expected === 'absent'
              ? 'CanonicalTitles key proven absent from this state root'
              : `CanonicalTitles value proven at this state root (${formatInt(proof.valueBytes)} B, revision ${capture.revision})`
          }
          detail={
            <>
              {proof.message}; {formatInt(proof.totalNodes)} nodes, {formatInt(proof.unusedNodes)} unused; key{' '}
              {hashShort(capture.storageKey, 10, 8)}
            </>
          }
        />
      </ul>

      {children}

      <details className="mt-3 border-t border-line pt-3" open={walkOpen}>
        <summary className="cursor-pointer text-[13px] text-ink-2">Proof path, {proof.steps.length} nodes walked</summary>
        <ProofWalk nodes={proof.steps} />
      </details>
    </Panel>
  )
}
