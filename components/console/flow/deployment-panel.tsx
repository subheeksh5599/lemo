'use client'

import { CopyButton } from '@/components/console/copy-button'
import { Panel, State } from '@/components/console/primitives'
import { CONTRACTS, type ContractSlot } from '@/lib/flow/config'
import type { FlowSnapshot } from '@/lib/flow/snapshot'
import type { Probe } from '@/lib/flow/state'
import { formatInt, ms } from '@/lib/format'
import { cn } from '@/lib/utils'

function probeFor(
  snapshot: FlowSnapshot | null,
  key: ContractSlot['key'],
): Probe<unknown> | null {
  if (snapshot === null) return null
  return snapshot[key] as Probe<unknown> | null
}

function Slot({ slot, probe }: { slot: ContractSlot; probe: Probe<unknown> | null }) {
  const deployed = probe !== null && probe.codeSize > 0 && probe.problem === null

  return (
    <li className="border-b border-line py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[12.5px] text-ink">{slot.label}</span>

        {slot.address === null ? (
          <State tone="warn">not deployed yet</State>
        ) : deployed ? (
          <span className="flex min-w-0 items-center gap-0.5">
            <span className="truncate font-mono text-[12px] tabular-nums text-ink-2">
              {slot.address}
            </span>
            <CopyButton value={slot.address} label={`the ${slot.label} address`} className="size-6" />
          </span>
        ) : (
          <State tone="warn">
            {probe === null ? 'not read' : probe.codeSize === 0 ? 'no code here' : 'did not answer'}
          </State>
        )}
      </div>

      <p className="mt-1 text-[11.5px] leading-4 text-muted">{slot.detail}</p>

      <p
        className={cn(
          'mt-1.5 break-words font-mono text-[10.5px] leading-4 tabular-nums',
          slot.address === null ? 'text-warn' : 'text-muted',
        )}
      >
        {slot.address === null
          ? (slot.problem ?? `${slot.env} is not set`)
          : `${slot.env} · ${
              probe === null
                ? 'reading'
                : probe.codeSize === 0
                  ? 'no code at this address'
                  : `${formatInt(probe.codeSize)} bytes of code${
                      probe.problem === null ? '' : `, ${probe.problem}`
                    }`
            }`}
      </p>
    </li>
  )
}

/**
 * What is deployed, where the address came from, and whether code actually
 * lives there. Nothing in this panel is a substituted address: an unset
 * variable is shown as unset, with its own name.
 */
export function DeploymentPanel({ snapshot }: { snapshot: FlowSnapshot | null }) {
  return (
    <Panel
      title="Deployment"
      hint={snapshot === null ? 'reading' : `chain ${formatInt(snapshot.chain.chainId)}`}
      aside={
        snapshot === null ? null : (
          <span className="font-mono text-[10px] tabular-nums text-muted">
            {ms(snapshot.latencyMs)}
          </span>
        )
      }
    >
      <ul>
        {CONTRACTS.map((slot) => (
          <Slot key={slot.key} slot={slot} probe={probeFor(snapshot, slot.key)} />
        ))}
      </ul>
    </Panel>
  )
}
