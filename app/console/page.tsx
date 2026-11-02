'use client'

import Link from 'next/link'
import { ArrowRight, Check, KeyRound, X } from 'lucide-react'

import { BlockTable } from '@/components/console/block-table'
import { CadenceChart, type CadencePoint } from '@/components/console/cadence-chart'
import { useConsole } from '@/components/console/console-provider'
import { NativeWitnessPanel } from '@/components/console/native-witness'
import { Notice, Panel } from '@/components/console/primitives'
import { useEvmProbe, useNativeModuleProbe } from '@/hooks/use-proof'
import {
  EXPECTED_GENESIS,
  EVM_RPC,
  MAX_IN_FLIGHT,
  NATIVE_RPC,
  median,
} from '@/lib/chain'
import { formatInt, hashShort, ms, slot } from '@/lib/format'
import { cn } from '@/lib/utils'

function Cell({
  label,
  value,
  note,
  tone = 'default',
  className,
}: {
  label: string
  value: React.ReactNode
  note: React.ReactNode
  tone?: 'default' | 'accent' | 'ok' | 'bad'
  className?: string
}) {
  const color =
    tone === 'accent'
      ? 'text-accent'
      : tone === 'ok'
        ? 'text-ok'
        : tone === 'bad'
          ? 'text-bad'
          : 'text-ink'

  return (
    <div className={cn('bg-surface px-4 py-4', className)}>
      <p className="meta truncate text-muted">{label}</p>
      <p
        className={cn(
          'mt-2 font-mono text-[28px] leading-none tracking-[-0.03em] tabular-nums',
          color,
        )}
      >
        {value}
      </p>
      <p className="mt-2 text-[12px] leading-4 text-muted [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">{note}</p>
    </div>
  )
}

function RuntimeComparison() {
  const { native, evm } = useConsole()
  const probe = useEvmProbe()
  const module = useNativeModuleProbe()

  const accountProof =
    probe.data === null
      ? 'reading'
      : probe.data.supported
        ? `served, ${probe.data.nodes} nodes`
        : 'refused'

  const accountTone: 'warn' | undefined =
    probe.data === null ? undefined : probe.data.supported ? undefined : 'warn'

  // Both cells below are read, never asserted: the native side asks the runtime
  // whether it exports the contracts runtime API, and the EVM side only claims
  // what eth_chainId and eth_blockNumber actually answered.
  const nativeContracts =
    module.error !== null
      ? 'not read'
      : module.data === null
        ? 'asking the runtime'
        : module.data.present === true
          ? 'api exported'
          : module.data.present === false
            ? 'no contracts api'
            : 'inconclusive'

  const contractsTone: 'warn' | undefined = module.data?.present === false ? 'warn' : undefined

  const rows: {
    label: string
    wasm: string
    evm: string
    tone?: 'ok' | 'warn'
    wasmTone?: 'ok' | 'warn'
  }[] = [
    {
      label: 'Height',
      wasm: native === null ? '-' : `#${formatInt(native.finalized.number)}`,
      evm: evm === null ? '-' : `#${formatInt(evm.head)}`,
    },
    {
      label: 'Identity',
      wasm: native?.chain ?? '-',
      evm: evm === null ? '-' : `${formatInt(evm.chainId)}`,
    },
    {
      label: 'State root',
      wasm: hashShort(native?.finalized.stateRoot, 8, 6),
      evm: hashShort(evm?.stateRoot, 8, 6),
    },
    {
      label: 'Contracts',
      wasm: nativeContracts,
      evm: evm === null ? 'no answer' : 'eth_chainId answered',
      wasmTone: contractsTone,
    },
    {
      label: 'Witness read',
      wasm: 'state_getReadProof',
      evm: 'eth_getProof',
    },
    {
      label: 'Account proof',
      wasm: 'not applicable',
      evm: accountProof,
      tone: accountTone,
    },
    {
      label: 'Round trip',
      wasm: native === null ? '-' : ms(native.latencyMs),
      evm: evm === null ? '-' : ms(evm.latencyMs),
    },
  ]

  return (
    <Panel
      title="Runtimes"
      hint="native and Revive, side by side"
      bodyClassName="px-4 py-2"
    >
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="meta py-2 text-left font-medium text-muted">
              Reading
            </th>
            <th scope="col" className="meta py-2 text-right font-medium text-muted">
              Native
            </th>
            <th scope="col" className="meta py-2 text-right font-medium text-muted">
              Revive
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-line/60 last:border-b-0">
              <td className="py-2 pr-2 text-[12px] text-muted">{row.label}</td>
              <td
                className={cn(
                  'max-w-[9rem] truncate py-2 pl-2 text-right font-mono text-[12px] tabular-nums',
                  row.wasmTone === 'warn'
                    ? 'text-warn'
                    : row.wasmTone === 'ok'
                      ? 'text-ok'
                      : 'text-ink-2',
                )}
              >
                {row.wasm}
              </td>
              <td
                className={cn(
                  'max-w-[9rem] truncate py-2 pl-2 text-right font-mono text-[12px] tabular-nums',
                  row.tone === 'warn' ? 'text-warn' : 'text-ink-2',
                )}
              >
                {row.evm}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 border-t border-line py-2 text-[12px] leading-5 text-muted">
        The native column reads storage at the finalized state root. The Revive column
        reports what the endpoint actually answered, including a refusal.
      </p>
    </Panel>
  )
}

export default function ConsoleOverview() {
  const { native, evm, blocks, blocksError, error, reading } = useConsole()

  const points: CadencePoint[] = blocks
    .filter((block) => block.intervalMs !== null)
    .map((block) => ({
      number: block.number,
      slot: (block.intervalMs ?? 0) / 1000,
      timestamp: block.timestamp,
    }))

  const middle = median(
    blocks.map((block) => block.intervalMs).filter((value): value is number => value !== null),
  )

  const lag = native === null ? null : native.best - native.finalized.number
  const genesisMatches =
    native === null ? null : native.genesis.toLowerCase() === EXPECTED_GENESIS.toLowerCase()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-medium tracking-[-0.03em] text-ink">Overview</h1>
          <p className="mt-1.5 font-mono text-[11.5px] tabular-nums text-muted">
            {native?.chain ?? '-'}
            {native === null
              ? ', reading the native endpoint'
              : `, finalized #${formatInt(native.finalized.number)} of #${formatInt(native.best)}`}
            {blocks.length === 0 ? '' : `, ${formatInt(blocks.length)} blocks read`}
          </p>
        </div>
        <p className="font-mono text-[10.5px] text-muted">
          read-only JSON-RPC, {formatInt(MAX_IN_FLIGHT)} calls at a time
        </p>
      </div>

      {error !== null && native === null ? (
        <Notice tone="bad" title="The native endpoint did not answer">
          {error}
        </Notice>
      ) : null}

      <section className="overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-5">
          <Cell
            label="Finalized head"
            value={native === null ? '-' : `#${formatInt(native.finalized.number)}`}
            note={
              native === null
                ? 'reading the chain'
                : `state root ${hashShort(native.finalized.stateRoot, 8, 6)}`
            }
          />
          <Cell
            label="Finality lag"
            value={lag === null ? '-' : formatInt(lag)}
            note="blocks behind the best head"
          />
          <Cell
            label="Median slot"
            value={slot(middle)}
            note={
              points.length === 0
                ? reading
                  ? 'reading the blocks'
                  : 'no measured intervals'
                : `median of ${formatInt(points.length)} intervals`
            }
          />
          <Cell
            label="Revive head"
            value={evm === null ? '-' : `#${formatInt(evm.head)}`}
            note={evm === null ? 'reading the endpoint' : `chain ID ${formatInt(evm.chainId)}`}
          />
          <Cell
            label="Genesis"
            value={
              genesisMatches === null ? (
                '-'
              ) : genesisMatches ? (
                <span className="inline-flex items-center gap-2">
                  <Check className="size-4 shrink-0 text-ok" strokeWidth={2.2} aria-hidden="true" />
                  match
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <X className="size-4 shrink-0 text-bad" strokeWidth={2.2} aria-hidden="true" />
                  differs
                </span>
              )
            }
            note={
              native === null
                ? 'comparing the configured genesis'
                : hashShort(native.genesis, 6, 6)
            }
            tone={genesisMatches === false ? 'bad' : genesisMatches ? 'ok' : 'default'}
            className="col-span-2 sm:col-span-1"
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.68fr)_minmax(0,1fr)]">
        <Panel
          title="Slot cadence"
          hint="finalized blocks, seconds between neighbours"
          className="flex flex-col"
          bodyClassName="flex flex-1 flex-col px-3.5 py-3"
        >
          <CadenceChart data={points} error={blocksError} />
        </Panel>

        <div className="grid gap-4">
          <NativeWitnessPanel />
          <Link
            href="/console/verify"
            className="group flex items-center justify-between gap-3 rounded-[12px] border border-line bg-surface px-4 py-3 transition-colors duration-150 hover:border-line-strong hover:bg-raised"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-line bg-canvas">
                <KeyRound className="size-4 text-accent" strokeWidth={1.6} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">Verify any key</span>
                <span className="mt-0.5 block truncate text-[12px] text-muted">
                  Paste a storage key and walk its proof.
                </span>
              </span>
            </span>
            <ArrowRight
              className="size-4 shrink-0 text-muted transition-colors duration-150 group-hover:text-ink-2"
              strokeWidth={1.6}
              aria-hidden="true"
            />
          </Link>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.68fr)_minmax(0,1fr)]">
        <Panel
          title="Recent finalized blocks"
          hint="newest first"
          bodyClassName="px-4 py-1"
          aside={
            <span className="font-mono text-[10px] tabular-nums text-muted">
              {blocksError === null
                ? `${formatInt(Math.min(10, blocks.length))} of ${formatInt(blocks.length)}`
                : 'stale'}
            </span>
          }
        >
          <BlockTable blocks={blocks} />
        </Panel>

        <div className="grid gap-4">
          <RuntimeComparison />
          <p className="px-1 font-mono text-[10.5px] leading-4 text-muted">
            {NATIVE_RPC.replace('https://', '')}
            <br />
            {EVM_RPC.replace('https://', '')}
          </p>
        </div>
      </div>
    </div>
  )
}
