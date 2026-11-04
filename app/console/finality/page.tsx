'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'

import { CopyButton } from '@/components/console/copy-button'
import { FigureBand, Figure, Notice, PageHeader, Panel, Row, Skeleton, State } from '@/components/console/primitives'
import { ScannerLink } from '@/components/console/scanner-link'
import {
  BEEFY_FEED,
  BEEFY_FEED_ENV,
  fetchBeefyMaterial,
  readBeefyFeed,
  verifyBeefy,
  type BeefyFeedReading,
  type BeefyMaterial,
  type BeefyStep,
  type StepValue,
  type Tamper,
} from '@/lib/beefy'
import { clockTime, formatInt, hashShort } from '@/lib/format'
import { scannerAccount, scannerBlock } from '@/lib/scanner'
import { cn } from '@/lib/utils'

const TONE: Record<NonNullable<StepValue['tone']>, string> = {
  ok: 'text-ok',
  bad: 'text-bad',
  muted: 'text-muted',
}

function Value({ item }: { item: StepValue }) {
  const isHash = item.value.startsWith('0x') && item.value.length > 22
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-line py-1.5 last:border-b-0">
      <span className="shrink-0 text-[13px] text-muted">{item.label}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span
          title={item.value}
          className={cn(
            'min-w-0 truncate font-mono text-[12px] tabular-nums',
            item.tone === undefined ? 'text-ink' : TONE[item.tone],
          )}
        >
          {isHash ? hashShort(item.value, 10, 8) : item.value}
        </span>
        {item.block === undefined ? null : <ScannerLink href={scannerBlock(item.block)} label={`#${item.block}`} />}
        {isHash ? <CopyButton value={item.value} label={item.label} /> : null}
      </span>
    </div>
  )
}

function StepCard({ step, index }: { step: BeefyStep; index: number }) {
  return (
    <li className="min-w-0 rounded-md border border-line bg-surface" data-step={step.id} data-pass={step.pass}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-2.5">
        <p className="flex min-w-0 items-baseline gap-2">
          <span className="font-mono text-[11px] tabular-nums text-muted">0{index + 1}</span>
          <span className="text-[14px] font-medium text-ink">{step.title}</span>
        </p>
        <State tone={step.pass ? 'ok' : 'bad'}>
          {step.pass ? (
            <Check className="size-3.5" strokeWidth={2} aria-hidden="true" />
          ) : (
            <X className="size-3.5" strokeWidth={2} aria-hidden="true" />
          )}
          {step.pass ? 'PASS' : 'FAIL'}
        </State>
      </header>
      <div className="grid gap-4 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="text-[13px] leading-5 text-ink-2">{step.summary}</p>
          <ul className="mt-2 space-y-1.5">
            {step.checks.map((check) => (
              <li key={check.label} className="flex min-w-0 items-start gap-2">
                <span className={cn('mt-0.5 font-mono text-[11px]', check.pass ? 'text-ok' : 'text-bad')}>
                  {check.pass ? 'pass' : 'fail'}
                </span>
                <span className="min-w-0">
                  <span className="text-[12px] text-ink">{check.label}</span>{' '}
                  <span className="break-all font-mono text-[11px] leading-4 text-muted">{check.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          {step.values.map((item) => (
            <Value key={item.label} item={item} />
          ))}
        </div>
      </div>
    </li>
  )
}

const TAMPERS: { value: Tamper; label: string }[] = [
  { value: 'none', label: 'Off' },
  { value: 'signature', label: 'Flip a signature byte' },
  { value: 'header', label: 'Flip a header byte' },
]

function FeedPanel() {
  const [reading, setReading] = useState<BeefyFeedReading | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (BEEFY_FEED === null) return
    let alive = true
    readBeefyFeed(BEEFY_FEED)
      .then((value) => {
        if (alive) setReading(value)
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : 'the feed did not answer')
      })
    return () => {
      alive = false
    }
  }, [])

  if (BEEFY_FEED === null) {
    return (
      <Panel title="On-chain feed" hint="BeefyRootFeed">
        <p className="text-[13px] text-muted">
          Not deployed yet: {BEEFY_FEED_ENV} is not set to a 0x address.
        </p>
      </Panel>
    )
  }

  return (
    <Panel
      title="On-chain feed"
      hint="BeefyRootFeed, read with eth_call"
      aside={<ScannerLink href={scannerAccount(BEEFY_FEED)} label="account" />}
    >
      <Row label="Address" value={hashShort(BEEFY_FEED, 6, 4)} title={BEEFY_FEED} />
      {error !== null ? (
        <p className="mt-2 text-[13px] text-bad">{error}</p>
      ) : reading === null ? (
        <div className="mt-2">
          <Skeleton lines={4} />
        </div>
      ) : (
        <>
          <Row
            label="currentRoot"
            value={reading.live ? hashShort(reading.currentRoot, 10, 8) : 'no root relayed yet'}
            title={reading.currentRoot}
            tone={reading.live ? 'default' : 'warn'}
          />
          <Row label="currentBlockNumber" value={`#${formatInt(reading.currentBlockNumber)}`} />
          {reading.beefyBlockNumber === null ? null : (
            <Row label="beefyBlockNumber" value={`#${formatInt(reading.beefyBlockNumber)}`} />
          )}
          <Row label="validatorSetId" value={formatInt(reading.validatorSetId)} />
          <Row
            label="quorum"
            value={
              reading.quorum === null
                ? '-'
                : reading.authoritySetSize === null
                  ? String(reading.quorum)
                  : `${reading.quorum} of ${reading.authoritySetSize}`
            }
          />
          <Row
            label="Header of that block, rehashed here"
            value={reading.header === null ? '-' : hashShort(reading.header.stateRoot, 10, 8)}
            title={reading.header?.stateRoot}
          />
          <Row
            label="currentRoot = browser-derived root"
            value={
              reading.matches === null ? (
                'no root to compare'
              ) : reading.matches ? (
                <State tone="ok">match</State>
              ) : (
                <State tone="bad">mismatch</State>
              )
            }
            mono={false}
          />
          {reading.live ? (
            <div className="mt-2 flex justify-end">
              <ScannerLink href={scannerBlock(reading.currentBlockNumber)} label={`#${reading.currentBlockNumber}`} />
            </div>
          ) : null}
        </>
      )}
    </Panel>
  )
}

export default function FinalityPage() {
  const [material, setMaterial] = useState<BeefyMaterial | null>(null)
  const [stage, setStage] = useState<string>('starting')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tamper, setTamper] = useState<Tamper>('none')
  const run = useRef(0)

  const load = useCallback(() => {
    const id = (run.current += 1)
    setBusy(true)
    setError(null)
    fetchBeefyMaterial((next) => {
      if (run.current === id) setStage(next)
    })
      .then((value) => {
        if (run.current === id) setMaterial(value)
      })
      .catch((cause: unknown) => {
        if (run.current === id) setError(cause instanceof Error ? cause.message : 'the node did not answer')
      })
      .finally(() => {
        if (run.current === id) setBusy(false)
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const verdict = useMemo(() => (material === null ? null : verifyBeefy(material, tamper)), [material, tamper])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Validator-signed roots"
        meta={
          material === null
            ? busy
              ? `reading: ${stage}`
              : 'not read yet'
            : `BEEFY block #${formatInt(material.block.number)}, set ${material.decoded.validatorSetId}, read ${clockTime(material.readAt)}`
        }
        action={
          <button type="button" className="btn btn--solid btn--sm" onClick={load} disabled={busy}>
            {busy ? 'Reading' : 'Re-run'}
          </button>
        }
      />

      <Notice title="This root comes from validator signatures, checked in this browser">
        The state root below is accepted only because Portaldot&apos;s BEEFY validators signed the MMR
        root that commits to its block. This page re-runs the checks BeefyRootFeed runs on-chain:
        signatures, MMR root, header hash. What is still trusted: the starting validator set, fixed
        when the feed is deployed, and the set itself, which today is 2 validators, so both must sign.
      </Notice>

      {error !== null ? (
        <Notice tone="bad" title="The read did not complete">
          {error}
        </Notice>
      ) : null}

      <FigureBand>
        <Figure
          label="Verdict"
          value={verdict === null ? '-' : verdict.pass ? 'PASS' : 'FAIL'}
          tone={verdict === null ? 'muted' : verdict.pass ? 'ok' : 'bad'}
          note={verdict?.tamperNote ?? (verdict === null ? undefined : 'untampered bytes from the node')}
        />
        <Figure
          label="BEEFY block"
          value={material === null ? '-' : `#${formatInt(material.block.number)}`}
          note={material === null ? undefined : `BEEFY head #${formatInt(material.beefyHead.number)}`}
        />
        <Figure
          label="Signers"
          value={verdict === null ? '-' : `${verdict.signers.filter((s) => s.pass).length} / ${material?.authorities.length ?? 0}`}
          note={verdict === null ? undefined : `validator set ${verdict.setId}`}
        />
        <Figure
          label={`State root of #${verdict === null ? 'N-1' : formatInt(verdict.headerBlock)}`}
          value={verdict?.stateRoot === null || verdict === null ? '-' : hashShort(verdict.stateRoot, 4, 4)}
          tone={verdict === null ? 'muted' : verdict.pass ? 'ok' : 'bad'}
        />
      </FigureBand>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="meta">Tamper</span>
        <div role="radiogroup" aria-label="Tamper" className="flex flex-wrap gap-2">
          {TAMPERS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={tamper === option.value}
              disabled={material === null}
              onClick={() => setTamper(option.value)}
              className={cn(
                'btn btn--sm',
                tamper === option.value ? 'border-line-bright text-ink' : 'btn--quiet',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-muted">in this browser only, nothing is sent</span>
      </div>

      {verdict === null ? (
        <Panel title="Checks" hint={busy ? stage : undefined}>
          <Skeleton lines={6} />
        </Panel>
      ) : (
        <ol className="space-y-3" aria-label="Checks">
          {verdict.steps.map((step, index) => (
            <StepCard key={step.id} step={step} index={index} />
          ))}
        </ol>
      )}

      <FeedPanel />
    </div>
  )
}
