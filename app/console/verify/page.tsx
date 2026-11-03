'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2, ShieldQuestion, X } from 'lucide-react'

import { CopyButton } from '@/components/console/copy-button'
import { Figure, Notice, PageHeader, Panel, Row } from '@/components/console/primitives'
import { ProofWalk } from '@/components/console/proof-walk'
import { useProofReader } from '@/hooks/use-proof'
import { SYSTEM_NUMBER_KEY, type StorageProof } from '@/lib/chain'
import { bytes, formatInt, hashShort, ms } from '@/lib/format'
import { cn } from '@/lib/utils'

const VERDICT = {
  valid: { tone: 'ok', word: 'verified', icon: Check },
  absent: { tone: 'warn', word: 'absent', icon: ShieldQuestion },
  incomplete: { tone: 'warn', word: 'incomplete', icon: AlertTriangle },
  'root-mismatch': { tone: 'bad', word: 'root mismatch', icon: X },
  invalid: { tone: 'bad', word: 'invalid', icon: X },
} as const

function validateKey(value: string): string | null {
  const body = value.trim().startsWith('0x') ? value.trim().slice(2) : value.trim()
  if (body.length === 0) return 'Enter a key in hex.'
  if (!/^[0-9a-fA-F]+$/.test(body)) return 'Hex only: 0-9 and a-f, optional 0x prefix.'
  if (body.length % 2 !== 0) return 'A hex key needs an even number of digits.'
  if (body.length > 2 * 128) return 'Keys above 128 bytes are not accepted here.'
  return null
}

function normalise(value: string): string {
  const body = value.trim().startsWith('0x') ? value.trim().slice(2) : value.trim()
  return `0x${body.toLowerCase()}`
}

function keyBytes(value: string): number | null {
  const body = value.trim().startsWith('0x') ? value.trim().slice(2) : value.trim()
  if (!/^[0-9a-fA-F]*$/.test(body)) return null
  return Math.floor(body.length / 2)
}

function CheckLine({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <Check className="mt-[3px] size-3.5 shrink-0 text-ok" strokeWidth={2.2} aria-hidden="true" />
      ) : (
        <X className="mt-[3px] size-3.5 shrink-0 text-warn" strokeWidth={2.2} aria-hidden="true" />
      )}
      <span className={cn('text-[13px] leading-5', ok ? 'text-ink-2' : 'text-warn')}>
        {children}
      </span>
    </li>
  )
}

function Result({ result }: { result: StorageProof }) {
  const state = result.verification
  const verdict = VERDICT[state.status]
  const Icon = verdict.icon
  const color =
    verdict.tone === 'ok' ? 'text-ok' : verdict.tone === 'warn' ? 'text-warn' : 'text-bad'

  const absentBoth = result.storageValue === null && result.provenValue === null

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-md border border-line bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-4">
          <div className="min-w-0">
            <p className={cn('flex items-center gap-2 font-mono text-[12px]', color)}>
              <Icon className="size-3.5" strokeWidth={2.2} aria-hidden="true" />
              {verdict.word}
            </p>
            <p className="mt-1.5 max-w-[52ch] text-[13px] leading-5 text-ink-2">{state.message}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="meta">Finalized block</p>
            <p className="mt-1 font-mono text-[13px] tabular-nums text-ink">
              #{formatInt(result.blockNumber)}
            </p>
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted">
              {ms(result.latencyMs)} round trip
            </p>
          </div>
        </div>

        <div className="grid gap-px bg-line sm:grid-cols-3 *:bg-surface *:px-4 *:py-4">
          <Figure
            label="Proven value"
            value={result.decoded === null ? 'absent' : result.decoded.value}
            note={
              result.decoded === null
                ? 'no bytes at this key'
                : `${result.decoded.reading}, ${result.decoded.note}`
            }
          />
          <Figure
            label="Proof nodes"
            value={formatInt(result.proofNodes)}
            note={`${bytes(result.proofBytes)}, ${formatInt(state.unusedNodes)} unused`}
          />
          <Figure
            label="Key bytes"
            value={formatInt(state.keyBytes)}
            note="read at the block hash"
          />
        </div>

        <div className="border-t border-line px-4 py-3">
          <ul className="space-y-2">
            <CheckLine ok={state.rootMatches}>
              a returned node rehashes to the state root in the finalized header
            </CheckLine>
            <CheckLine ok={state.ok || state.status === 'absent'}>
              the walk follows the key nibbles to a decision
            </CheckLine>
            <CheckLine ok={absentBoth || result.storageMatches}>
              {absentBoth
                ? 'state_getStorage returned null at the same block, so absence agrees'
                : result.storageMatches
                  ? 'the proven bytes equal state_getStorage at the same block'
                  : 'the proven bytes differ from state_getStorage at the same block'}
            </CheckLine>
          </ul>
        </div>

        <div className="border-t border-line px-4 py-1">
          <Row
            label="State root"
            value={hashShort(result.stateRoot, 10, 8)}
            title={result.stateRoot}
            tone="muted"
          />
          <Row
            label="Root node"
            value={state.computedRoot === null ? '-' : hashShort(state.computedRoot, 10, 8)}
            title={state.computedRoot ?? undefined}
            tone={state.rootMatches ? 'ok' : 'bad'}
          />
          <Row
            label="Block hash"
            value={hashShort(result.blockHash, 10, 8)}
            title={result.blockHash}
            tone="muted"
          />
          <Row label="Proven hex" value={result.provenValue ?? 'null'} tone="muted" />
          <Row label="state_getStorage" value={result.storageValue ?? 'null'} tone="muted" />
          {state.missing.length === 0 ? null : (
            <Row label="Missing nodes" value={`${state.missing.length}`} tone="warn" />
          )}
        </div>
      </section>

      <Panel
        title="Trie walk"
        hint={`${result.nodes.length} nodes on the path`}
        bodyClassName="px-4 pb-2 pt-0"
      >
        <ProofWalk nodes={result.nodes} />
        {state.missing.length === 0 ? null : (
          <div className="mt-2 border-t border-line pt-2">
            <p className="meta">Hashes the proof did not carry</p>
            <ul className="mt-1 space-y-0.5">
              {state.missing.map((hash) => (
                <li key={hash} className="truncate font-mono text-[11px] text-warn" title={hash}>
                  {hash}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
    </div>
  )
}

export default function ConsoleVerify() {
  const reader = useProofReader(SYSTEM_NUMBER_KEY)
  const [input, setInput] = useState(SYSTEM_NUMBER_KEY)
  const [invalid, setInvalid] = useState<string | null>(null)

  const size = keyBytes(input)
  const tooShort = size !== null && size < 16 && size > 0

  const submitted = useMemo(
    () => (reader.submitted === null ? null : hashShort(reader.submitted, 12, 8)),
    [reader.submitted],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Verify a storage key"
        meta="state_getReadProof and state_getStorage at the finalized hash, walked in this browser against that header's state root"
      />

      <Notice title="One node reports the checkpoint">
        The state root comes from the same node that serves the proof. Reading that root from one
        node is the assumption this check rests on; the walk itself trusts nothing it is sent.
      </Notice>

      <Panel title="Input" hint="hex storage key">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            const problem = validateKey(input)
            setInvalid(problem)
            if (problem === null) void reader.run(normalise(input))
          }}
        >
          <div>
            <label htmlFor="storage-key" className="meta block pb-2">
              Storage key
            </label>
            <div className="relative">
              <input
                id="storage-key"
                name="storage-key"
                value={input}
                onChange={(event) => {
                  setInput(event.target.value)
                  if (invalid !== null) setInvalid(validateKey(event.target.value))
                }}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                aria-invalid={invalid !== null}
                aria-describedby="storage-key-help"
                placeholder="0x"
                className={cn(
                  'h-10 w-full rounded-sm border bg-canvas pl-3 pr-20 font-mono text-[12px] text-ink outline-none transition-colors duration-150 focus:border-accent',
                  invalid === null ? 'border-line' : 'border-bad/60',
                )}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[11px] tabular-nums text-muted">
                {size === null ? 'hex' : `${formatInt(size)} bytes`}
              </span>
            </div>
            <p id="storage-key-help" className="mt-1.5 text-[11px] leading-4 text-muted">
              32 bytes for a plain item. A map key appends its hasher output, which this page
              does not guess.
              {tooShort ? ' Shorter than 16 bytes is unlikely to name a pallet item.' : ''}
            </p>
            {invalid === null ? null : (
              <p role="alert" className="mt-1 text-[12px] leading-4 text-bad">
                {invalid}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={reader.reading}
              className="btn btn--solid btn--sm"
            >
              {reader.reading ? (
                <Loader2 className="size-3.5 animate-spin" strokeWidth={2} aria-hidden="true" />
              ) : null}
              {reader.reading ? 'Verifying' : 'Verify'}
            </button>
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              onClick={() => {
                setInput(SYSTEM_NUMBER_KEY)
                setInvalid(null)
                void reader.run(SYSTEM_NUMBER_KEY)
              }}
            >
              System.Number key
            </button>
            {submitted === null ? null : (
              <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-muted">
                last key {submitted}
                <CopyButton value={reader.submitted ?? ''} label="the last verified key" />
              </span>
            )}
          </div>
        </form>
      </Panel>

      {reader.error === null ? null : (
        <Notice tone="bad" title="The node did not return a proof for this key">
          <p className="font-mono text-[12px]">{reader.error}</p>
          <button
            type="button"
            className="btn btn--sm mt-2"
            onClick={() => void reader.run(reader.submitted ?? SYSTEM_NUMBER_KEY)}
          >
            Try again
          </button>
        </Notice>
      )}

      {reader.reading && reader.result === null ? (
        <Panel title="Proof" hint="reading">
          <div className="flex items-center gap-2 py-1 text-[12px] text-muted">
            <Loader2 className="size-3.5 animate-spin text-muted" strokeWidth={2} aria-hidden="true" />
            Reading the read proof and state_getStorage at the finalized head.
          </div>
        </Panel>
      ) : null}

      {reader.result === null ? (
        reader.reading || reader.error !== null ? null : (
          <Panel title="Proof" hint="nothing read">
            <p className="py-1 text-[12px] text-muted">
              Submit a key to read its proof. The default is System.Number at the finalized head.
            </p>
          </Panel>
        )
      ) : (
        <Result result={reader.result} />
      )}
    </div>
  )
}
