'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2, X } from 'lucide-react'

import { useConsole } from '@/components/console/console-provider'
import { CopyButton } from '@/components/console/copy-button'
import { PageHeader, Panel, Row } from '@/components/console/primitives'
import { useEvmProbe, useNativeModuleProbe, useNativeWitness } from '@/hooks/use-proof'
import {
  EXPECTED_CHAIN_ID,
  EXPECTED_GENESIS,
  EVM_RPC,
  MAX_IN_FLIGHT,
  NATIVE_RPC,
  measureLatency,
  type LatencyReading,
} from '@/lib/chain'
import { formatInt, hashShort, ms } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Constant, not a reading: the calls this build is written to make. The table
 * below is an inventory of the code, so it is labelled as such on screen.
 */
const METHODS: { method: string; runtime: 'native' | 'revive'; purpose: string }[] = [
  { method: 'system_chain', runtime: 'native', purpose: 'chain name' },
  { method: 'chain_getBlockHash', runtime: 'native', purpose: 'genesis, best and per block hashes' },
  { method: 'chain_getFinalizedHead', runtime: 'native', purpose: 'the hash every read is pinned to' },
  { method: 'chain_getHeader', runtime: 'native', purpose: 'block number, state root' },
  { method: 'chain_getBlock', runtime: 'native', purpose: 'timestamp inherent, extrinsic count' },
  { method: 'state_getReadProof', runtime: 'native', purpose: 'trie nodes for one key' },
  { method: 'state_getStorage', runtime: 'native', purpose: 'the value the proof is compared with' },
  { method: 'state_call', runtime: 'native', purpose: 'whether a runtime api is exported' },
  { method: 'eth_chainId', runtime: 'revive', purpose: 'chain identity' },
  { method: 'eth_blockNumber', runtime: 'revive', purpose: 'head' },
  { method: 'eth_getBlockByNumber', runtime: 'revive', purpose: 'finalized block, producer, root' },
  { method: 'eth_getProof', runtime: 'revive', purpose: 'account witness, answer reported as it comes' },
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
      <span className={cn('text-[13px]', pass === null ? 'text-muted' : 'text-ink-2')}>{label}</span>
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
      <div className="flex items-center justify-between gap-2 rounded-sm border border-line bg-canvas px-2.5 py-2">
        <p className="min-w-0 truncate font-mono text-[12px] text-ink-2" title={endpoint}>
          {endpoint}
        </p>
        <CopyButton value={endpoint} label={`the ${runtime} endpoint`} />
      </div>

      <div className="mt-2">
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
              value={latency.samples.map((sample) => `${Math.round(sample)} ms`).join(', ')}
              tone="muted"
            />
          </>
        )}
      </div>

      <div className="border-t border-line">{children}</div>
    </Panel>
  )
}

export default function ConsoleNetwork() {
  const { native, evm, error } = useConsole()
  const witness = useNativeWitness()
  const probe = useEvmProbe()
  const module = useNativeModuleProbe()
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
  const finalizedAtOrBelowBest =
    native === null ? null : native.finalized.number <= native.best
  const witnessRead =
    witness.error !== null ? false : witness.data === null ? null : witness.data.verification.rootMatches
  // Neutral: the call is what is checked, not an assumed answer.
  const proofCallAnswered = probe.data === null ? null : probe.error === null
  const moduleProbeAnswered = module.data === null ? null : module.data.present !== null

  return (
    <div className="space-y-4">
      <PageHeader
        title="Network"
        meta={`two endpoints, at most ${formatInt(MAX_IN_FLIGHT)} calls in flight`}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <EndpointPanel
          title="Native records"
          hint="native runtime reads, pinned to the finalized hash"
          endpoint={NATIVE_RPC}
          runtime="native"
          latency={nativeLatency}
        >
          <Row label="Chain" value={native?.chain ?? '-'} />
          <Row
            label="Contracts api"
            value={
              module.error !== null
                ? 'not read'
                : module.data === null
                  ? 'asking the runtime'
                  : module.data.present === true
                    ? `exported (${module.data.method})`
                    : module.data.present === false
                      ? 'no such method'
                      : 'inconclusive'
            }
            tone={
              module.data?.present === false ? 'warn' : module.data?.present === true ? 'ok' : 'muted'
            }
            title={module.data?.message ?? module.data?.method}
          />
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
          hint="eth_chainId, eth_blockNumber"
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
        <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <li className="flex items-start justify-between gap-3 border-b border-line/60 pb-2 sm:border-b-0 sm:pb-0">
            <CheckRow pass={reachable} label="Native endpoint answers" />
            <span className="shrink-0 font-mono text-[12px] text-muted">
              {error === null ? 'ok' : 'failed'}
            </span>
          </li>
          <li className="flex items-start justify-between gap-3 border-b border-line/60 pb-2 sm:border-b-0 sm:pb-0">
            <CheckRow pass={genesisMatches} label="Genesis matches the configured network" />
            <span className="shrink-0 font-mono text-[12px] text-muted">
              {genesisMatches === null ? 'waiting' : genesisMatches ? 'match' : 'differs'}
            </span>
          </li>
          <li className="flex items-start justify-between gap-3 border-b border-line/60 pb-2 sm:border-b-0 sm:pb-0">
            <CheckRow pass={chainIdMatches} label="Revive chain ID matches the configured network" />
            <span className="shrink-0 font-mono text-[12px] text-muted">
              {evm === null ? 'waiting' : formatInt(evm.chainId)}
            </span>
          </li>
          <li className="flex items-start justify-between gap-3 border-b border-line/60 pb-2 sm:border-b-0 sm:pb-0">
            <CheckRow
              pass={finalizedAtOrBelowBest}
              label="Finalized head does not run past the best head"
            />
            <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted">
              {native === null
                ? 'waiting'
                : `${formatInt(native.finalized.number)} / ${formatInt(native.best)}`}
            </span>
          </li>
          <li className="flex items-start justify-between gap-3">
            <CheckRow pass={witnessRead} label="A native read proof comes back and roots" />
            <span className="shrink-0 font-mono text-[12px] text-muted">
              {witness.data === null ? 'reading' : `${witness.data.proofNodes} nodes`}
            </span>
          </li>
          <li className="flex items-start justify-between gap-3">
            <CheckRow
              pass={proofCallAnswered}
              label="The account proof call comes back, served or refused"
            />
            <span className="shrink-0 font-mono text-[12px] text-muted">
              {probe.data === null ? 'asking' : probe.data.supported ? 'served' : 'refused'}
            </span>
          </li>
          <li className="flex items-start justify-between gap-3">
            <CheckRow
              pass={moduleProbeAnswered}
              label="The runtime answers whether it exports the contracts api"
            />
            <span className="shrink-0 font-mono text-[12px] text-muted">
              {module.data === null
                ? 'asking'
                : module.data.present === true
                  ? 'exported'
                  : module.data.present === false
                    ? 'absent'
                    : 'inconclusive'}
            </span>
          </li>
        </ul>
        {error === null ? null : (
          <p className="mt-3 flex items-start gap-2 border-t border-line pt-3 text-[13px] text-bad">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            {error}
          </p>
        )}
      </Panel>

      <Panel
        title="Methods this console calls"
        hint="what this build is written to call, not a reading"
        bodyClassName="px-4 pt-1 pb-0"
      >
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="meta py-2 text-left font-medium text-muted">
                Method
              </th>
              <th scope="col" className="meta py-2 text-left font-medium text-muted">
                Runtime
              </th>
              <th scope="col" className="meta hidden py-2 text-left font-medium text-muted sm:table-cell">
                Reads
              </th>
            </tr>
          </thead>
          <tbody>
            {METHODS.map((entry) => (
              <tr key={entry.method} className="border-b border-line/60 last:border-b-0">
                <td className="py-2 pr-4 font-mono text-[12px] text-ink">{entry.method}</td>
                <td className="py-2 pr-4 text-[13px] text-muted">
                  {entry.runtime === 'native' ? 'native records' : 'revive'}
                </td>
                <td className="hidden py-2 text-[13px] text-muted sm:table-cell">
                  {entry.purpose}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-line py-3 text-[12px] leading-5 text-muted">
          Every call goes through one queue holding at most {formatInt(MAX_IN_FLIGHT)} calls,
          with retries on network errors and 429/503, because these public endpoints drop
          connections above about two concurrent requests. Roots come from chain_getHeader at the
          finalized hash; one node reports that checkpoint, which is the trust assumption this
          console rests on. The console makes no cross-VM calls, so it reports none.
        </p>
      </Panel>
    </div>
  )
}
