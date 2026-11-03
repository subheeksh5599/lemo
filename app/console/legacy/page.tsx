'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, RefreshCw, X } from 'lucide-react'

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
import { explorerTxUrl } from '@/lib/flow/config'
import { formatInt, hashShort, ms, relativeTime } from '@/lib/format'
import {
  LEGACY_TITLE,
  LEGACY_TOKEN,
  LEGACY_TITLE_ID,
  readLegacy,
  type LegacySnapshot,
} from '@/lib/legacy'

function raw(value: bigint): string {
  return formatInt(Number(value))
}

function txStatus(status: 'success' | 'reverted' | 'missing') {
  if (status === 'success') {
    return (
      <State tone="ok">
        <Check className="size-3" strokeWidth={1.8} aria-hidden="true" />
        settled
      </State>
    )
  }
  if (status === 'reverted') {
    return (
      <State tone="bad">
        <X className="size-3" strokeWidth={1.8} aria-hidden="true" />
        reverted
      </State>
    )
  }
  return <State tone="warn">no receipt</State>
}

export default function LegacyPage() {
  const [snapshot, setSnapshot] = useState<LegacySnapshot | null>(null)
  const [reading, setReading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const read = useCallback(async () => {
    setReading(true)
    setProblem(null)
    try {
      setSnapshot(await readLegacy())
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'the read failed')
    } finally {
      setReading(false)
    }
  }, [])

  useEffect(() => {
    void read()
  }, [read])

  const data = snapshot

  return (
    <div className="space-y-4">
      <PageHeader
        title="Earlier deployment"
        meta={
          data === null
            ? 'reading the two contracts'
            : `EVM-only registry and token, read ${relativeTime(data.readAt)}, ${ms(data.latencyMs)}`
        }
        action={
          <button type="button" onClick={() => void read()} disabled={reading} className="btn btn--sm">
            <RefreshCw
              className={reading ? 'size-3.5 animate-spin' : 'size-3.5'}
              strokeWidth={1.8}
              aria-hidden="true"
            />
            {reading ? 'Reading' : 'Re-read'}
          </button>
        }
      />

      <Notice tone="warn" title="A predecessor, EVM-only, not the native-proof gate">
        <p>
          The earlier registry holds the title record in EVM storage, and the token checks that
          registry before a transfer. The mint and transfers below are real Portaldot V3
          transactions, but no native record is proven and the issuer key is not held by this
          console. Read it as evidence of an EVM-only lifecycle, not as the dual-runtime design.
          The four-contract gate that replaces it is paused.
        </p>
        <Link
          href="/console/flow"
          className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-ink-2 transition-colors duration-150 hover:text-ink"
        >
          Open the four-contract gate
          <ArrowRight className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
        </Link>
      </Notice>

      {problem !== null ? (
        <Notice tone="bad" title="The earlier deployment did not answer">
          <p>{problem}</p>
        </Notice>
      ) : null}

      <FigureBand>
        <Figure
          label="Representation supply"
          value={data === null ? '-' : raw(data.token.supply)}
          note="raw base units; 18 decimals declared"
        />
        <Figure
          label="Supply cap"
          value={data === null ? '-' : raw(data.token.cap)}
          note="immutable raw base units"
        />
        <Figure
          label="Title eligibility"
          value={data === null ? '-' : data.title.eligible ? 'eligible' : 'frozen'}
          note="read from eligible(titleId)"
          tone={data === null ? 'default' : data.title.eligible ? 'ok' : 'warn'}
        />
        <Figure
          label="Issuer balance"
          value={data === null ? '-' : raw(data.token.issuerBalance)}
          note="the old key still holds the rest"
        />
      </FigureBand>

      {data === null ? (
        <Panel title="Reading the predecessor" hint="waiting for the node">
          <Skeleton lines={8} />
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Title record" hint="EVM storage, not native">
            <Row label="Registry" value={hashShort(LEGACY_TITLE, 8, 6)} title={LEGACY_TITLE} />
            <Row label="Title id" value={hashShort(LEGACY_TITLE_ID, 8, 6)} title={LEGACY_TITLE_ID} />
            <Row label="Asset" value={hashShort(data.title.asset, 8, 6)} title={data.title.asset} />
            <Row label="Backing" value={formatInt(Number(data.title.backing))} />
            <Row label="Revision" value={formatInt(data.title.revision)} />
            <Row label="Digest" value={hashShort(data.title.digest, 8, 6)} title={data.title.digest} />
            <Row
              label="Eligible"
              value={data.title.eligible ? 'true' : 'false'}
              tone={data.title.eligible ? 'ok' : 'warn'}
            />
          </Panel>

          <Panel title="Representation token" hint="ERC-20, 18 decimals">
            <Row label="Token" value={hashShort(LEGACY_TOKEN, 8, 6)} title={LEGACY_TOKEN} />
            <Row label="Registry" value={hashShort(data.token.registry, 8, 6)} title={data.token.registry} />
            <Row label="Issuer" value={hashShort(data.token.issuer, 8, 6)} title={data.token.issuer} />
            <Row label="Total supply" value={raw(data.token.supply)} />
            <Row label="Cap" value={raw(data.token.cap)} />
            <Row label="Decimals" value={formatInt(data.token.decimals)} />
            <Row label="Issuer balance" value={raw(data.token.issuerBalance)} />
          </Panel>
        </div>
      )}

      <Panel
        title="Settled transactions"
        hint="receipts read from the chain"
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="meta px-4 py-2.5 text-left font-medium text-muted">
                  Action
                </th>
                <th scope="col" className="meta px-4 py-2.5 text-left font-medium text-muted">
                  Transaction
                </th>
                <th scope="col" className="meta px-4 py-2.5 text-right font-medium text-muted">
                  Block
                </th>
                <th scope="col" className="meta px-4 py-2.5 text-right font-medium text-muted">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {data === null
                ? Array.from({ length: 5 }, (_, index) => (
                    <tr key={index} className="border-b border-line/60 last:border-b-0">
                      <td className="px-4 py-3" colSpan={4}>
                        <Skeleton lines={1} />
                      </td>
                    </tr>
                  ))
                : data.receipts.map((item) => (
                    <tr key={item.hash} className="border-b border-line/60 last:border-b-0">
                      <td className="px-4 py-3">
                        <p className="text-[13px] text-ink">{item.label}</p>
                        <p className="mt-0.5 text-[12px] leading-4 text-muted">{item.note}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1">
                          <Link
                            href={`/tx/${item.hash}`}
                            title={item.hash}
                            className="font-mono text-[12px] tabular-nums text-ink-2 underline decoration-line-strong underline-offset-4 transition-colors duration-150 hover:text-ink"
                          >
                            {hashShort(item.hash, 10, 8)}
                          </Link>
                          <CopyButton value={item.hash} label="the transaction hash" />
                          {explorerTxUrl(item.hash) === null ? null : (
                            <a
                              href={explorerTxUrl(item.hash) ?? undefined}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="ml-2 font-mono text-[11px] text-muted transition-colors duration-150 hover:text-ink"
                            >
                              explorer
                            </a>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[12px] tabular-nums text-ink-2">
                        {item.block === null ? '-' : `#${formatInt(item.block)}`}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {txStatus(item.status)}
                        {item.problem === null ? null : (
                          <p className="mt-1 max-w-[24ch] text-[11px] leading-4 text-bad">
                            {item.problem}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="What the predecessor proves">
          <ul className="list-disc space-y-2 pl-4 text-[13px] leading-5 text-muted marker:text-faint">
            <li>An ERC-20 can be minted to a cap and moved while a registry says the title is eligible.</li>
            <li>A transfer is refused when the same registry marks the title ineligible, and works again after it is restored.</li>
            <li>Every one of those transitions has a settled transaction and a receipt on Portaldot V3.</li>
          </ul>
        </Panel>
        <Panel title="What it does not prove" hint="the gap the four-contract gate fills">
          <ul className="list-disc space-y-2 pl-4 text-[13px] leading-5 text-muted marker:text-faint">
            <li>No native title record, no Substrate storage proof and no finalized state root.</li>
            <li>No Rule 2: the registry cannot block native backing from leaving while the token exists.</li>
            <li>No native unbond, identity, vesting or permissions. This is an EVM-only title, not the dual-runtime one.</li>
          </ul>
        </Panel>
      </div>

    </div>
  )
}
