'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Check, X } from 'lucide-react'

import { Notice, Panel, Row, Skeleton, State } from '@/components/console/primitives'
import { EVM_RPC, rpc } from '@/lib/chain'
import { formatInt, hashShort } from '@/lib/format'

type Receipt = {
  status?: string
  blockNumber?: string
  from?: string
  to?: string | null
  gasUsed?: string
  cumulativeGasUsed?: string
  contractAddress?: string | null
  logs?: unknown[]
  transactionHash?: string
}

const HASH = /^0x[0-9a-fA-F]{64}$/

function number(hex: string | undefined): string {
  return hex === undefined ? '-' : formatInt(Number(BigInt(hex)))
}

export default function TransactionPage() {
  const params = useParams<{ hash: string }>()
  const raw = params?.hash
  const hash = Array.isArray(raw) ? raw[0] : raw

  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [reading, setReceiptReading] = useState(true)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function read() {
      if (hash === undefined || !HASH.test(hash)) {
        setProblem('The address bar does not contain a 32-byte transaction hash.')
        setReceiptReading(false)
        return
      }

      setReceiptReading(true)
      try {
        const value = await rpc<Receipt | null>(EVM_RPC, 'eth_getTransactionReceipt', [hash])
        if (!cancelled) {
          setReceipt(value)
          setProblem(value === null ? 'No receipt was returned. The transaction may not exist or may not be mined.' : null)
        }
      } catch (error) {
        if (!cancelled) setProblem(error instanceof Error ? error.message : 'the receipt read failed')
      } finally {
        if (!cancelled) setReceiptReading(false)
      }
    }

    void read()
    return () => {
      cancelled = true
    }
  }, [hash])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="meta text-muted">Portaldot V3 / transaction</p>
          <h1 className="mt-1 break-all font-mono text-[22px] leading-[1.25] tracking-[-0.02em] text-ink">
            {hash ?? 'no hash'}
          </h1>
        </div>
        <Link href="/console/legacy" className="btn btn--quiet btn--sm h-7 px-2">
          <ArrowLeft className="size-3" strokeWidth={1.8} aria-hidden="true" />
          Earlier deployment
        </Link>
      </div>

      <Notice tone="idle" title="Receipt view, not an indexer">
        <p className="max-w-[88ch]">
          This page asks the Portaldot V3 EVM RPC for one receipt by hash. It proves the
          transaction was mined and shows its status and block; it does not browse history or
          claim to be the chain's official explorer.
        </p>
      </Notice>

      {reading ? (
        <Panel title="Reading the receipt" hint="eth_getTransactionReceipt">
          <Skeleton lines={7} />
        </Panel>
      ) : problem !== null ? (
        <Notice tone="bad" title="No receipt">
          <p>{problem}</p>
        </Notice>
      ) : receipt === null ? null : (
        <Panel title="Receipt" hint="read at request time">
          <Row
            label="Status"
            value={
              <State tone={receipt.status === '0x1' ? 'ok' : 'bad'}>
                {receipt.status === '0x1' ? (
                  <Check className="size-3" strokeWidth={1.8} aria-hidden="true" />
                ) : (
                  <X className="size-3" strokeWidth={1.8} aria-hidden="true" />
                )}
                {receipt.status === '0x1' ? 'success' : 'reverted'}
              </State>
            }
          />
          <Row label="Block" value={receipt.blockNumber ? `#${number(receipt.blockNumber)}` : '-'} />
          <Row label="From" value={hashShort(receipt.from, 10, 8)} title={receipt.from} />
          <Row
            label="To"
            value={receipt.to === null || receipt.to === undefined ? 'contract creation' : hashShort(receipt.to, 10, 8)}
            title={receipt.to ?? undefined}
          />
          <Row label="Gas used" value={number(receipt.gasUsed)} />
          <Row label="Logs" value={formatInt(receipt.logs?.length ?? 0)} />
          {receipt.contractAddress === null || receipt.contractAddress === undefined ? null : (
            <Row
              label="Contract created"
              value={hashShort(receipt.contractAddress, 10, 8)}
              title={receipt.contractAddress}
            />
          )}
        </Panel>
      )}
    </div>
  )
}
