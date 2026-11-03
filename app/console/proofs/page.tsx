'use client'

import { CopyButton } from '@/components/console/copy-button'
import { EvmWitnessPanel } from '@/components/console/evm-witness'
import { NativeWitnessPanel } from '@/components/console/native-witness'
import { PageHeader, Panel, Row } from '@/components/console/primitives'
import { SYSTEM_NUMBER_KEY } from '@/lib/chain'
import { hashShort } from '@/lib/format'
import { twox128, toHex } from '@/lib/proofs'

function KeyPanel() {
  const pallet = toHex(twox128('System'))
  const item = toHex(twox128('Number'))

  return (
    <Panel title="Key derivation" hint="twox128 halves">
      <div className="flex items-center justify-between gap-2 pb-1">
        <p className="meta">System.Number, plain item, no map segment</p>
        <CopyButton value={SYSTEM_NUMBER_KEY} label="the System.Number storage key" />
      </div>
      <Row label="twox128(System)" value={hashShort(pallet, 10, 8)} title={pallet} tone="muted" />
      <Row label="twox128(Number)" value={hashShort(item, 10, 8)} title={item} tone="muted" />
      <div className="mt-2 rounded-sm border border-line bg-canvas px-3 py-2">
        <p className="break-all font-mono text-[11px] leading-4 text-ink-2">{SYSTEM_NUMBER_KEY}</p>
      </div>
      <p className="mt-2 text-[12px] leading-5 text-muted">
        The key is the two prefixes concatenated, 32 bytes, read at the finalized block hash
        rather than at latest.
      </p>
    </Panel>
  )
}

const CHECKS = [
  ['01', 'Rehash', 'blake2b-256 over each returned node, never trusted as sent'],
  ['02', 'Root', 'one node must hash to the state root in the finalized header'],
  ['03', 'Walk', 'prefixes and the child bitmap carry the key nibble by nibble'],
  ['04', 'Compare', 'the proven bytes must equal state_getStorage at the same block'],
]

export default function ConsoleProofs() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Proofs"
        meta="one native witness and one EVM probe, read at the finalized head and verified in this browser"
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <NativeWitnessPanel variant="full" />

        <div className="grid gap-4">
          <KeyPanel />
          <EvmWitnessPanel />
        </div>
      </div>

      <Panel title="What the check means" hint="four steps, node order not trusted">
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
          {CHECKS.map(([index, name, detail]) => (
            <div key={index} className="min-w-0 border-l border-line pl-3">
              <p className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] tabular-nums text-muted">{index}</span>
                <span className="text-[13px] text-ink">{name}</span>
              </p>
              <p className="mt-1 text-[12px] leading-5 text-muted">{detail}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-line pt-3 text-[12px] leading-5 text-muted">
          The state root is the finalized checkpoint the node reports. Reading that root
          from one node is the trust assumption behind the check, not something this
          console removes. This console makes no cross-VM calls.
        </p>
      </Panel>
    </div>
  )
}
