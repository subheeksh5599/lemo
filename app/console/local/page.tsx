'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, ShieldCheck, X } from 'lucide-react'

import { CopyButton } from '@/components/console/copy-button'
import {
  Figure,
  FigureBand,
  Notice,
  PageHeader,
  Panel,
  Row,
  Skeleton,
  State,
} from '@/components/console/primitives'
import { ProofWalk } from '@/components/console/proof-walk'
import { formatInt, hashShort } from '@/lib/format'
import {
  CANONICAL_RECORD_BYTES,
  loadLocalCapture,
  type CaptureCheck,
  type LocalCaptureReport,
} from '@/lib/local-capture'
import { cn } from '@/lib/utils'

const VERDICT = {
  valid: { tone: 'ok', word: 'verified' },
  absent: { tone: 'warn', word: 'absent' },
  incomplete: { tone: 'warn', word: 'incomplete' },
  'root-mismatch': { tone: 'bad', word: 'root mismatch' },
  invalid: { tone: 'bad', word: 'invalid' },
} as const

function utc(value: string): string {
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return value
  return `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** 32 bytes a line, groups of four, so a word boundary stays visible. */
function hexLines(hex: string): string[] {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex
  const lines: string[] = []

  for (let offset = 0; offset < body.length; offset += 64) {
    lines.push(body.slice(offset, offset + 64).replace(/(.{8})/g, '$1 ').trim())
  }

  return lines
}

function CheckLine({ check }: { check: CaptureCheck }) {
  const Icon = check.tone === 'ok' ? Check : check.tone === 'warn' ? AlertTriangle : X
  const color = check.tone === 'ok' ? 'text-ok' : check.tone === 'warn' ? 'text-warn' : 'text-bad'

  return (
    <li className="flex items-start gap-2 border-b border-line/60 py-2 last:border-b-0">
      <Icon className={cn('mt-[3px] size-3.5 shrink-0', color)} strokeWidth={2.1} aria-hidden="true" />
      <div className="min-w-0">
        <p className={cn('text-[13px] leading-5', check.tone === 'ok' ? 'text-ink-2' : color)}>
          {check.label}
        </p>
        <p className="mt-0.5 break-words font-mono text-[11px] leading-4 text-muted">
          {check.detail}
        </p>
      </div>
    </li>
  )
}

function Report({ report }: { report: LocalCaptureReport }) {
  const { fixture, proof, record } = report
  const verdict = VERDICT[proof.status]

  return (
    <div className="space-y-4">
      <FigureBand>
        <Figure
          label="Source"
          value="local-lemo-runtime"
          note={`fixture source field; ${fixture.chain}`}
        />
        <Figure
          label="Finalized block"
          value={`#${formatInt(fixture.finalized.number)}`}
          note={hashShort(fixture.finalized.hash, 10, 6)}
        />
        <Figure
          label="Canonical value"
          value={`${formatInt(report.valueBytes)} B`}
          note="ten words, measured from the hex"
          tone={report.valueBytes === CANONICAL_RECORD_BYTES ? 'ok' : 'warn'}
        />
        <Figure
          label="Proof"
          value={verdict.word}
          note={`${formatInt(proof.totalNodes)} nodes, ${formatInt(proof.unusedNodes)} unused`}
          tone={verdict.tone}
        />
      </FigureBand>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Finalized header" hint="local devnet">
          <Row label="Chain" value={fixture.chain} />
          <Row label="Endpoint" value={fixture.endpoint} />
          <Row label="Runtime" value={fixture.runtime.specName} title={fixture.runtime.specName} />
          <Row
            label="Spec / state version"
            value={`${fixture.runtime.specVersion} / ${fixture.runtime.stateVersion}`}
          />
          <Row label="Block" value={`#${formatInt(fixture.finalized.number)}`} />
          <Row
            label="Block hash"
            value={<span title={fixture.finalized.hash}>{hashShort(fixture.finalized.hash, 10, 8)}</span>}
            tone="muted"
          />
          <Row
            label="Parent hash"
            value={
              <span title={fixture.finalized.parentHash}>
                {hashShort(fixture.finalized.parentHash, 10, 8)}
              </span>
            }
            tone="muted"
          />
          <Row
            label="State root"
            value={<span title={fixture.finalized.stateRoot}>{hashShort(fixture.finalized.stateRoot, 10, 8)}</span>}
            tone="accent"
          />
          <Row
            label="Genesis"
            value={<span title={fixture.genesis}>{hashShort(fixture.genesis, 10, 8)}</span>}
            tone="muted"
          />
          <Row label="Captured" value={utc(fixture.capturedAt)} tone="muted" />
        </Panel>

        <Panel
          title="Canonical record"
          hint="decoded from the proven bytes"
        >
          <Row
            label="Title id"
            value={<span title={record.titleId}>{hashShort(record.titleId, 10, 8)}</span>}
          />
          <Row label="Chain id" value={record.chainIdLabel} title={fixture.record.chainId} />
          <Row
            label="EVM beneficiary"
            value={<span title={record.ownerWord}>{hashShort(record.ownerLow20, 10, 8)}</span>}
          />
          <Row
            label="Backing"
            value={<span title={record.backing}>{hashShort(record.backing, 10, 8)}</span>}
          />
          <Row label="Revision" value={record.revision.toString()} />
          <Row
            label="Native asset"
            value={<span title={record.nativeAsset}>{hashShort(record.nativeAsset, 10, 8)}</span>}
            tone="muted"
          />
          <Row
            label="EVM contract"
            value={record.evmContract}
            title={record.evmContract}
            tone="muted"
          />
          <p className="mt-3 text-[12px] leading-5 text-muted">
            Word 4 is the explicit EVM beneficiary {record.ownerLow20}. The native
            account is {fixture.record.owner}; the record keeps both namespaces
            instead of truncating the account id.
          </p>
        </Panel>
      </div>

      <Panel
        title="Verification"
        hint={`${fixture.canonicalProofNodes.length} committed nodes, walked here`}
        aside={
          <State tone={verdict.tone}>
            <ShieldCheck className="size-3" strokeWidth={1.8} aria-hidden="true" />
            {verdict.word}
          </State>
        }
      >
        <p className="max-w-[92ch] text-[13px] leading-5 text-ink-2">
          {proof.message}. The walk reads the canonical storage key against the state root in the
          finalized header, re-hashing every node it is handed, so the order the capture stored the
          nodes in does not matter.
        </p>

        <ul className="mt-3">
          {report.checks.map((check) => (
            <CheckLine key={check.label} check={check} />
          ))}
        </ul>

        <div className="mt-4 grid gap-x-6 border-t border-line pt-1 sm:grid-cols-2">
          <Row label="Proof nodes" value={formatInt(proof.totalNodes)} />
          <Row label="Unused nodes" value={formatInt(proof.unusedNodes)} />
          <Row label="Key bytes" value={formatInt(proof.keyBytes)} />
          <Row
            label="Last node walked"
            value={
              <span title={proof.computedRoot ?? undefined}>
                {proof.computedRoot === null ? '-' : hashShort(proof.computedRoot, 10, 8)}
              </span>
            }
            tone="muted"
          />
        </div>

        <div className="mt-3 border-t border-line pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="meta">Proof path</p>
            <p className="font-mono text-[11px] tabular-nums text-muted">
              {proof.valueHashed ? 'value node hashed into the walk' : 'value inline in the leaf'}
            </p>
          </div>
          <ProofWalk nodes={proof.steps} />
        </div>
      </Panel>

      <Panel
        title="Canonical value"
        hint={`${formatInt(report.valueBytes)} bytes, ten 32 byte words`}
        aside={
          <span className="flex items-center gap-1">
            <span className="meta">{`uint8[${report.valueBytes}]`}</span>
            <CopyButton value={fixture.canonicalValue} label="canonical value" />
          </span>
        }
      >
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="min-w-0">
            <pre className="overflow-x-auto rounded-sm border border-line bg-canvas px-3 py-2.5 font-mono text-[11px] leading-[1.55] text-ink-2">
              {hexLines(fixture.canonicalValue).join('\n')}
            </pre>
            <p className="mt-2 font-mono text-[11px] tabular-nums text-muted">
              {report.valueBytes === report.declaredValueBytes
                ? `the fixture declares ${formatInt(report.declaredValueBytes)} bytes, and the hex measures the same`
                : `the fixture declares ${formatInt(report.declaredValueBytes)} bytes; the hex measures ${formatInt(report.valueBytes)}. The hex is the record here.`}
            </p>
          </div>

          <div className="min-w-0">
            <Row
              label="Canonical key"
              value={
                <span title={fixture.canonicalStorageKey}>
                  {hashShort(fixture.canonicalStorageKey, 10, 8)}
                </span>
              }
            />
            <Row
              label="Title id"
              value={<span title={fixture.titleId}>{hashShort(fixture.titleId, 10, 8)}</span>}
            />
            <Row
              label="Proven value"
              value={
                proof.valueHex !== null &&
                proof.valueHex.toLowerCase() === fixture.canonicalValue.toLowerCase()
                  ? 'equals the capture'
                  : 'differs from the capture'
              }
              tone={
                proof.valueHex !== null &&
                proof.valueHex.toLowerCase() === fixture.canonicalValue.toLowerCase()
                  ? 'ok'
                  : 'bad'
              }
            />
            <Row
              label="Representation live"
              value={fixture.representationLive ? 'yes' : 'no'}
              tone={fixture.representationLive ? 'ok' : 'muted'}
            />
            <p className="mt-3 text-[12px] leading-5 text-muted">
              The record was read once, at the block above. There is no second read of{' '}
              <span className="font-mono">state_getStorage</span> to compare against, because no node
              is running: the proof is the whole of the evidence here.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  )
}

export default function LocalCapturePage() {
  const [report, setReport] = useState<LocalCaptureReport | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    try {
      setReport(loadLocalCapture())
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'the capture did not load')
    }
  }, [])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Local capture"
        meta={
          report === null
            ? 'loading the committed fixture'
            : `local-lemo-runtime, block #${formatInt(report.fixture.finalized.number)}, captured ${utc(report.fixture.capturedAt)}`
        }
      />

      <Notice tone="warn" title="A local devnet capture, not public Portaldot">
        <p>
          <span className="font-mono">fixtures/lemo-local-capture.json</span> was read from a
          solochain template node at <span className="font-mono">ws://127.0.0.1:9944</span>, running
          development mode. This page reads no node and no wallet: the proof is recomputed in the
          browser from the committed bytes, and the console&apos;s live status strip is a separate
          read of the configured endpoint. Nothing here is evidence of a mint, a transfer, or public
          network state.
        </p>
      </Notice>

      {problem !== null ? (
        <Notice tone="bad" title="The capture did not load">
          <p>{problem}</p>
          <p className="mt-1">
            The page reads <span className="font-mono">fixtures/lemo-local-capture.json</span> directly,
            so a broken capture shows up here rather than being papered over.
          </p>
        </Notice>
      ) : null}

      {report === null && problem === null ? (
        <Panel title="Verifying the capture" hint="no network">
          <Skeleton lines={9} />
        </Panel>
      ) : null}

      {report === null ? null : <Report report={report} />}
    </div>
  )
}
