'use client'

import { Check, X } from 'lucide-react'

import { BlockTable } from '@/components/console/block-table'
import { CadenceChart, type CadencePoint } from '@/components/console/cadence-chart'
import { useConsole } from '@/components/console/console-provider'
import { NativeWitnessPanel } from '@/components/console/native-witness'
import { useRootSource } from '@/components/console/root-source'
import { Figure, FigureBand, Notice, PageHeader, Panel } from '@/components/console/primitives'
import { useEvmProbe, useNativeModuleProbe } from '@/hooks/use-proof'
import { EXPECTED_GENESIS, median } from '@/lib/chain'
import { formatInt, hashShort, ms, slot } from '@/lib/format'
import { cn } from '@/lib/utils'

function RuntimeComparison() {
  const { native, evm } = useConsole()
  const probe = useEvmProbe()
  const module = useNativeModuleProbe()
  const rootSource = useRootSource()

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
    title?: string
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
      // The one slot that names the gate's root source. The feed type comes
      // from components/console/root-source.tsx, so a new feed kind only
      // changes the label there.
      label: 'Root source',
      wasm: 'finalized header',
      evm:
        rootSource.kind === 'read'
          ? rootSource.label
          : rootSource.kind === 'reading'
            ? 'reading the feed'
            : rootSource.kind === 'unset'
              ? `${rootSource.env} not set`
              : 'feed did not answer',
      tone:
        rootSource.kind === 'read' && rootSource.feed.attester !== null
          ? 'warn'
          : rootSource.kind === 'failed'
            ? 'warn'
            : undefined,
      title:
        rootSource.kind === 'read'
          ? `feed ${rootSource.address}`
          : rootSource.kind === 'failed'
            ? rootSource.message
            : undefined,
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
              <td className="py-2 pr-2 text-[13px] text-muted">{row.label}</td>
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
                title={row.title ?? row.evm}
              >
                {row.evm}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 border-t border-line pt-2 pb-1 text-[12px] leading-5 text-muted">
        The native column reads storage at the finalized state root. The Revive column
        reports what the endpoint answered, including a refusal. Root source is where the EVM
        gate gets the native root it checks proofs against.
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
      <PageHeader
        title="Overview"
        meta={
          <>
            {native?.chain ?? '-'}
            {native === null
              ? ', reading the native endpoint'
              : `, finalized #${formatInt(native.finalized.number)} of #${formatInt(native.best)}`}
            {blocks.length === 0 ? '' : `, ${formatInt(blocks.length)} blocks read`}
          </>
        }
      />

      {error !== null && native === null ? (
        <Notice tone="bad" title="The native endpoint did not answer">
          {error}
        </Notice>
      ) : null}

      <FigureBand className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        <Figure
          label="Finalized head"
          value={native === null ? '-' : `#${formatInt(native.finalized.number)}`}
          note={
            native === null
              ? 'reading the chain'
              : `state root ${hashShort(native.finalized.stateRoot, 8, 6)}`
          }
        />
        <Figure
          label="Finality lag"
          value={lag === null ? '-' : formatInt(lag)}
          note="blocks behind the best head"
        />
        <Figure
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
        <Figure
          label="Revive head"
          value={evm === null ? '-' : `#${formatInt(evm.head)}`}
          note={evm === null ? 'reading the endpoint' : `chain ID ${formatInt(evm.chainId)}`}
        />
        <div className="col-span-2 sm:col-span-1">
          <Figure
            label="Genesis"
            value={
              genesisMatches === null ? (
                '-'
              ) : (
                <span className="inline-flex items-center gap-2">
                  {genesisMatches ? (
                    <Check className="size-5 shrink-0" strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <X className="size-5 shrink-0" strokeWidth={2} aria-hidden="true" />
                  )}
                  {genesisMatches ? 'match' : 'differs'}
                </span>
              )
            }
            note={
              native === null ? 'comparing the configured genesis' : hashShort(native.genesis, 6, 6)
            }
            tone={genesisMatches === false ? 'bad' : genesisMatches ? 'ok' : 'default'}
          />
        </div>
      </FigureBand>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.68fr)_minmax(0,1fr)]">
        <Panel
          title="Slot cadence"
          hint="finalized blocks, seconds between neighbours"
          className="flex flex-col"
          bodyClassName="flex flex-1 flex-col p-4"
        >
          <CadenceChart data={points} error={blocksError} />
        </Panel>

        <NativeWitnessPanel />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.68fr)_minmax(0,1fr)]">
        <Panel
          title="Recent finalized blocks"
          hint="newest first"
          bodyClassName="px-4 py-1"
          aside={
            <span className="meta">
              {blocksError === null
                ? `${formatInt(Math.min(10, blocks.length))} of ${formatInt(blocks.length)}`
                : 'stale'}
            </span>
          }
        >
          <BlockTable blocks={blocks} />
        </Panel>

        <RuntimeComparison />
      </div>
    </div>
  )
}
