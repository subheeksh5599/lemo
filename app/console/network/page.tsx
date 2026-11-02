'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2, X } from 'lucide-react'

import { useConsole } from '@/components/console/console-provider'
import { CopyButton } from '@/components/console/copy-button'
import { Panel, Row } from '@/components/console/primitives'
import { useEvmProbe, useNativeWitness } from '@/hooks/use-proof'
import {
  EXPECTED_CHAIN_ID,
  EXPECTED_GENESIS,
  EVM_RPC,
  NATIVE_RPC,
  measureLatency,
  type LatencyReading,
} from '@/lib/chain'
import { formatInt, hashShort, ms } from '@/lib/format'
import { cn } from '@/lib/utils'

const METHODS: { method: string; runtime: 'native' | 'revive'; purpose: string }[] = [
  { method: 'system_chain', runtime: 'native', purpose: 'chain name' },
  { method: 'chain_getBlockHash', runtime: 'native', purpose: 'genesis, best and per block hashes' },
  { method: 'chain_getFinalizedHead', runtime: 'native', purpose: 'the hash every read is pinned to' },
  { method: 'chain_getHeader', runtime: 'native', purpose: 'block number, state root' },
  { method: 'chain_getBlock', runtime: 'native', purpose: 'timestamp inherent, extrinsic count' },
  { method: 'state_getReadProof', runtime: 'native', purpose: 'trie nodes for one key' },
  { method: 'state_getStorage', runtime: 'native', purpose: 'the value the proof is compared with' },
  { method: 'eth_chainId', runtime: 'revive', purpose: 'chain identity' },
  { method: 'eth_blockNumber', runtime: 'revive', purpose: 'head' },
  { method: 'eth_getBlockByNumber', runtime: 'revive', purpose: 'finalized block, producer, root' },
  { method: 'eth_getProof', runtime: 'revive', purpose: 'account witness, refused on this endpoint' },
]

function CheckRow({ pass, label }: { pass: boolean | null; label: string }) {
  return (
    <span className="flex items-center gap-2">
      {pass === null ? (
        <Loader2 className="size-3.5 animate-spin text-muted" strokeWidth={2} aria-hidden="true" />
      ) : pass ? (
        <Check className="size-3.5 text-ok" strokeWidth={2.4} aria-hidden="true" />
      ) : (
        <X className="size-3.5 text-bad" strokeWidth={2.4} aria-hidden="true" />
      )}
      <span className={cn('text-[12px]', pass === null ? 'text-muted' : 'text-ink-2')}>{label}</span>
    </span>
  )
}

function EndpointPanel({
  title,
  hint,
  endpoint,
  runtime,
  latency,
  children,
}: {
  title: string
  hint: string
  endpoint: string
  runtime: 'native' | 'revive'
  latency: LatencyReading | undefined
  children: React.ReactNode
}) {
  return (
    <Panel title={title} hint={hint}>
      <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-canvas px-2.5 py-2">
        <p className="min-w-0 truncate font-mono text-[11px] text-ink-2" title={endpoint}>
          {endpoint}
        </p>
        <CopyButton value={endpoint} label={`the ${runtime} endpoint`} />
      </div>

      <div className="mt-1.5">
        {latency === undefined ? (
          <Row label="Round trip" value="measuring" tone="muted" />
        ) : latency.error !== null ? (
          <Row label="Round trip" value={latency.error} tone="bad" />
        ) : (
          <>
            <Row
              label={`Round trip, ${latency.method}`}
              value={latency.medianMs === null ? '-' : ms(latency.medianMs)}
            />
            <Row
              label="Samples"
              value={latency.samples.map((sample) => `${Math.round(sample)} ms`).join(' · ')}
              tone="muted"
            />
          </>
        )}
      </div>

      <div className="mt-1 border-t border-line pt-1">{children}</div>
    </Panel>
  )
}

export default function ConsoleNetwork() {
  const { native, evm, error } = useConsole()
  const witness = useNativeWitness()
  const probe = useEvmProbe()
  const [latency, setLatency] = useState<LatencyReading[] | null>(null)

  useEffect(() => {
    let alive = true
    void measureLatency(3).then((readings) => {
      if (alive) setLatency(readings)
    })
    return () => {
      alive = false
    }
  }, [])

  const nativeLatency = latency?.find((reading) => reading.runtime === 'wasm')
  const evmLatency = latency?.find((reading) => reading.runtime === 'revive')

  const reachable = native === null ? null : error === null
  const genesisMatches =
    native === null ? null : native.genesis.toLowerCase() === EXPECTED_GENESIS.toLowerCase()
  const chainIdMatches = evm === null ? null : evm.chainId === EXPECTED_CHAIN_ID
  const finalityOrdered = native === null ? null : native.finalized.number <= native.best
  const proofServed = witness.data === null ? null : witness.data.verification.rootMatches
  const evmRefused = probe.data === null ? null : !probe.data.supported

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[19px] font-medium tracking-[-0.02em] text-ink">Network</h1>
          <p className="mt-1 font-mono text-[11px] text-muted">
            two endpoints, one serialized queue, every call listed
          </p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
          concurrency held at 1
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <EndpointPanel
          title="Native records"
          hint="assets, identity, vesting"
          endpoint={NATIVE_RPC}
          runtime="native"
          latency={nativeLatency}
        >
          <Row label="Chain" value={native?.chain ?? '-'} />
          <Row label="Contracts module" value="not launched" tone="warn" />
          <Row
            label="Genesis"
            value={hashShort(native?.genesis, 10, 8)}
            title={native?.genesis}
            tone="muted"
          />
          <Row
            label="Finalized head"
            value={native === null ? '-' : `#${formatInt(native.finalized.number)}`}
          />
          <Row label="Best head" value={native === null ? '-' : `#${formatInt(native.best)}`} />
          <Row
            label="State root"
            value={hashShort(native?.finalized.stateRoot, 10, 8)}
            title={native?.finalized.stateRoot}
            tone="muted"
          />
          <Row
            label="Block hash"
            value={hashShort(native?.finalized.hash, 10, 8)}
            title={native?.finalized.hash}
            tone="muted"
          />
          <Row
            label="Parent hash"
            value={hashShort(native?.finalized.parentHash, 10, 8)}
            title={native?.finalized.parentHash}
            tone="muted"
          />
        </EndpointPanel>

        <EndpointPanel
          title="Revive runtime"
          hint="EVM, live"
          endpoint={EVM_RPC}
          runtime="revive"
          latency={evmLatency}
        >
          <Row label="Chain ID" value={evm === null ? '-' : formatInt(evm.chainId)} />
          <Row label="Head" value={evm === null ? '-' : `#${formatInt(evm.head)}`} />
          <Row
            label="State root"
            value={hashShort(evm?.stateRoot, 10, 8)}
            title={evm?.stateRoot ?? undefined}
            tone="muted"
          />
          <Row
            label="Block hash"
            value={hashShort(evm?.blockHash, 10, 8)}
            title={evm?.blockHash ?? undefined}
            tone="muted"
          />
          <Row
            label="Account proofs"
            value={probe.data === null ? 'reading' : probe.data.supported ? 'served' : 'refused'}
            tone={probe.data === null ? 'muted' : probe.data.supported ? 'ok' : 'warn'}
          />
          {probe.data === null || probe.data.supported ? (
            <Row label="Method" value="eth_getProof" tone="muted" />
          ) : (
            <Row label="Answer" value={probe.data.reason} tone="warn" />
          )}
          <Row label="Head read" value={evm === null ? '-' : ms(evm.latencyMs)} tone="muted" />
        </EndpointPanel>
      </div>

      <Panel title="Checks" hint="each one is a call this page made">
        <ul className="grid gap-2.5 sm:grid-cols-2">
          <li className="flex items-start justify-between gap-3 border-b border-line/60 pb-2 sm:border-b-0 sm:pb-0">
            <CheckRow pass={reachable} label="Native endpoint answers" />
            <span className="shrink-0 font-mono text-[10.5px] text-muted">
              {error === null ? 'ok' : 'failed'}
            </span>
          </li>
          <li className="flex items-start justify-between gap-3 border-b border-line/60 pb-2 sm:border-b-0 sm:pb-0">
            <CheckRow pass={genesisMatches} label="Genesis matches the configured network" />
            <span className="shrink-0 font-mono text-[10.5px] text-muted">
              {genesisMatches === null ? 'waiting' : genesisMatches ? 'match' : 'differs'}
            </span>
          </li>
          <li className="flex items-start justify-between gap-3 border-b border-line/60 pb-2 sm:border-b-0 sm:pb-0">
            <CheckRow pass={chainIdMatches} label="Revive chain ID matches the configured network" />
            <span className="shrink-0 font-mono text-[10.5px] text-muted">
              {evm === null ? 'waiting' : formatInt(evm.chainId)}
            </span>
          </li>
          <li className="flex items-start justify-between gap-3 border-b border-line/60 pb-2 sm:border-b-0 sm:pb-0">
            <CheckRow pass={finalityOrdered} label="Finalized head does not run past the best head" />
            <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted">
              {native === null
                ? 'waiting'
                : `${formatInt(native.finalized.number)} / ${formatInt(native.best)}`}
            </span>
          </li>
          <li className="flex items-start justify-between gap-3">
            <CheckRow pass={proofServed} label="A native read proof comes back and roots" />
            <span className="shrink-0 font-mono text-[10.5px] text-muted">
              {witness.data === null ? 'reading' : `${witness.data.proofNodes} nodes`}
            </span>
          </li>
          <li className="flex items-start justify-between gap-3">
            <CheckRow pass={evmRefused} label="Revive refuses an account proof, as reported" />
            <span className="shrink-0 font-mono text-[10.5px] text-muted">
              {probe.data === null ? 'asking' : probe.data.supported ? 'answered' : 'refused'}
            </span>
          </li>
        </ul>
        {error === null ? null : (
          <p className="mt-2 flex items-start gap-2 border-t border-line pt-2 text-[11.5px] text-bad">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            {error}
          </p>
        )}
      </Panel>

      <Panel
        title="Methods this console calls"
        hint="no batched or unrestricted fan out"
        bodyClassName="px-3.5 py-1.5"
      >
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="meta py-2 text-left font-medium text-ink-2/80">
                Method
              </th>
              <th scope="col" className="meta py-2 text-left font-medium text-ink-2/80">
                Runtime
              </th>
              <th scope="col" className="meta hidden py-2 text-left font-medium text-ink-2/80 sm:table-cell">
                Reads
              </th>
            </tr>
          </thead>
          <tbody>
            {METHODS.map((entry) => (
              <tr key={entry.method} className="border-b border-line/60 last:border-b-0">
                <td className="py-1.5 pr-3 font-mono text-[11px] text-ink">{entry.method}</td>
                <td className="py-1.5 pr-3 text-[11.5px] text-muted">
                  {entry.runtime === 'native' ? 'native records' : 'revive'}
                </td>
                <td className="hidden py-1.5 text-[11.5px] text-muted sm:table-cell">
                  {entry.purpose}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-line py-2 text-[11px] leading-4 text-muted">
          Every call goes through one queue with retries on network errors and 429/503,
          because these public endpoints drop connections above about two concurrent requests.
          Cross-VM calls between the two environments are not confirmed on this network.
        </p>
        <p className="border-t border-line py-2 text-[11px] leading-4 text-muted">
          Roots come from chain_getHeader at the finalized hash. One node reports that
          checkpoint, which is the trust assumption this console rests on.
        </p>
      </Panel>
    </div>
  )
}
