'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Check, X } from 'lucide-react'

import { CopyButton } from '@/components/console/copy-button'
import { Notice, PageHeader, Panel, Row, Skeleton, State } from '@/components/console/primitives'
import { EVM_RPC, rpc } from '@/lib/chain'
import { formatInt, hashShort } from '@/lib/format'
import { scannerAccount, scannerBlock } from '@/lib/scanner'
import { ScannerLink } from '@/components/console/scanner-link'

type Receipt = {
  status?: string
  blockNumber?: string
  transactionIndex?: string
  from?: string
  to?: string | null
  gasUsed?: string
  cumulativeGasUsed?: string
  contractAddress?: string | null
  logs?: unknown[]
  transactionHash?: string
}

const HASH = /^0x[0-9a-fA-F]{64}$/

function int(hex: string | undefined): number | null {
  return hex === undefined ? null : Number(BigInt(hex))
}

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
      <PageHeader
        title="Transaction receipt"
        meta={
          <span className="flex min-w-0 items-center gap-1">
            <span className="break-all">{hash ?? 'no hash in the address bar'}</span>
            {hash === undefined ? null : <CopyButton value={hash} label="the transaction hash" />}
          </span>
        }
        action={
          <Link href="/console/legacy" className="btn btn--quiet btn--sm">
            <ArrowLeft className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
            Earlier deployment
          </Link>
        }
      />

      <Notice tone="idle" title="Receipt view, not an indexer">
        <p>
          This page asks the Portaldot V3 EVM RPC for one receipt by hash. It proves the
          transaction was mined and shows its status and block; it does not browse history or
          claim to be the chain&apos;s official explorer. On Portaldot V3 the transaction is an
          unsigned <code>revive.ethTransact</code> extrinsic. The scanner lists signed extrinsics only, so
          the links below open its block and the contract&apos;s mapped account there.
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
          <Row
            label="Block"
            value={
              <span className="inline-flex items-center gap-2">
                {receipt.blockNumber ? `#${number(receipt.blockNumber)}` : '-'}
                <ScannerLink href={scannerBlock(int(receipt.blockNumber))} label="block" />
              </span>
            }
          />
          <Row
            label="Extrinsic"
            value={
              receipt.blockNumber && receipt.transactionIndex
                ? `${int(receipt.blockNumber)}-${int(receipt.transactionIndex)}, revive.ethTransact`
                : '-'
            }
          />
          <Row label="From" value={hashShort(receipt.from, 10, 8)} title={receipt.from} />
          <Row
            label="To"
            value={
              receipt.to === null || receipt.to === undefined ? (
                'contract creation'
              ) : (
                <span className="inline-flex items-center gap-2">
                  {hashShort(receipt.to, 10, 8)}
                  <ScannerLink href={scannerAccount(receipt.to)} label="account" />
                </span>
              )
            }
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
