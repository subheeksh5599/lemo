'use client'

import { Clock, Loader2, ShieldCheck } from 'lucide-react'

import { Notice, Panel, Row, State } from '@/components/console/primitives'
import { useVerification } from '@/hooks/use-flow'
import { contract } from '@/lib/flow/config'
import type { ParsedProof, ProofBinding } from '@/lib/flow/proof'
import type { GateState, Probe, VerifierState } from '@/lib/flow/state'
import { formatInt, hashShort, ms } from '@/lib/format'
import { cn } from '@/lib/utils'

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad'> = {
  PROVEN: 'ok',
  ABSENT: 'warn',
  INCOMPLETE: 'warn',
  INVALID: 'bad',
  ROOT_MISMATCH: 'bad',
  VALUE_MISMATCH: 'bad',
  NONE: 'warn',
}

/**
 * The read-only half of the flow: the same proof the action would carry, handed
 * to the verifier with the commitment the gate is anchored on. It answers what
 * the gate would decide, without a wallet and without a transaction.
 */
export function VerifyPanel({
  proof,
  binding,
  gate,
  verifier,
}: {
  proof: { parsed: ParsedProof | null; problem: string | null }
  binding: ProofBinding | null
  gate: Probe<GateState> | null
  verifier: Probe<VerifierState> | null
}) {
  const verification = useVerification(verifier?.address ?? null)
  const gateState = gate?.state ?? null
  const result = verification.result

  const verifierSlot = contract('verifier')

  return (
    <Panel
      title="Verify the proof"
      hint="read-only, eth_call"
      aside={
        result === null ? null : (
          <State tone={STATUS_TONE[result.statusWord] ?? 'warn'}>{result.statusWord}</State>
        )
      }
    >
      <p className="max-w-[64ch] text-[11.5px] leading-4 text-muted">
        Sends the proof to the verifier with the commitment the gate holds. The verifier walks the
        trie, decodes the record and recomputes its commitment, so a mismatch shows up here before
        any wallet is involved.
      </p>

      {verifierSlot.address === null ? (
        <p className="mt-3 text-[12px] leading-5 text-warn">
          {verifierSlot.env} is not set, so there is no verifier to hand a proof to.
        </p>
      ) : verifier === null ? (
        <p className="mt-3 flex items-center gap-2 py-1 text-[12px] text-muted">
          <Loader2 className="size-3.5 animate-spin" strokeWidth={2} aria-hidden="true" />
          Reading the verifier at {verifierSlot.address}.
        </p>
      ) : verifier.state === null ? (
        <div className="mt-3">
          <Notice
            tone="warn"
            title={verifier.codeSize === 0 ? 'No contract at this address' : 'The verifier did not answer'}
          >
            <p className="max-w-[56ch]">
              {verifier.codeSize === 0 ? (
                <>
                  {verifierSlot.env} points at{' '}
                  <span className="break-all font-mono text-[11px]">{verifier.address}</span>, and
                  the endpoint reports no code there.
                </>
              ) : (
                verifier.problem ?? 'the verifier did not answer'
              )}
            </p>
            {verifier.codeSize === 0 ? null : (
              <p className="mt-1 break-all font-mono text-[10.5px] text-muted">
                {verifier.address}
              </p>
            )}
          </Notice>
        </div>
      ) : gateState === null ? (
        <div className="mt-3">
          <Notice tone="warn" title="No gate commitment to check against">
            The verifier is deployed, but the gate did not answer, so there is no anchor commitment
            to hand it.
          </Notice>
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={verification.running || proof.parsed === null || binding === null}
              onClick={() => {
                if (proof.parsed !== null && binding !== null) {
                  void verification.run(proof.parsed, binding, gateState.titleCommitment)
                }
              }}
              className="btn btn--sm h-8"
            >
              {verification.running ? (
                <Loader2 className="size-3.5 animate-spin" strokeWidth={2} aria-hidden="true" />
              ) : (
                <ShieldCheck className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
              )}
              {verification.running ? 'Verifying' : 'Run verification'}
            </button>

            <span className="font-mono text-[10.5px] leading-4 text-muted">
              {proof.parsed === null
                ? (proof.problem ?? 'paste a proof in the panel above')
                : binding === null
                  ? 'waiting for the verifier operation ids'
                  : `revision ${proof.parsed.revision.toString()}, operation ${binding.operation}`}
            </span>
          </div>

          {verification.error === null ? null : (
            <p role="alert" className="mt-2 font-mono text-[11px] leading-4 text-bad">
              {verification.error}
            </p>
          )}

          {result === null ? null : (
            <div className="mt-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
                <p className="text-[12.5px] text-ink">
                  {result.statusWord === 'PROVEN'
                    ? 'The verifier returned a decoded record under this root.'
                    : `The verifier returned ${result.statusWord}.`}
                </p>
                <span className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-muted">
                  <Clock className="size-3" strokeWidth={1.8} aria-hidden="true" />
                  {ms(result.latencyMs)}
                </span>
              </div>

              <Row
                label="status"
                value={`${formatInt(Number(result.status))} ${result.statusWord}`}
                tone={STATUS_TONE[result.statusWord] ?? 'warn'}
              />
              <Row
                label="record title id"
                value={hashShort(result.record.titleId, 8, 6)}
                title={result.record.titleId}
                tone={
                  gateState.titleId.toLowerCase() === result.record.titleId.toLowerCase()
                    ? 'default'
                    : 'warn'
                }
              />
              <Row
                label="record chain id"
                value={result.record.chainId.toString()}
                tone={
                  result.record.chainId === gateState.boundChainId ? 'default' : 'warn'
                }
              />
              <Row
                label="record revision"
                value={result.record.revision.toString()}
                tone={
                  result.record.revision >= gateState.acceptedRevision ? 'default' : 'warn'
                }
              />
              <Row
                label="record owner"
                value={hashShort(result.record.owner, 6, 4)}
                title={result.record.owner}
              />
              <Row
                label="representation"
                value={hashShort(result.record.evmContract, 6, 4)}
                title={result.record.evmContract}
                tone={
                  gate?.address != null &&
                  result.record.evmContract.toLowerCase() === gate.address.toLowerCase()
                    ? 'default'
                    : 'warn'
                }
              />
              <Row
                label="backing bound"
                value={
                  /^0x0{64}$/.test(result.record.backing) ? (
                    <State tone="warn">unbound</State>
                  ) : (
                    hashShort(result.record.backing, 6, 4)
                  )
                }
                title={result.record.backing}
                mono={false}
              />
              <Row
                label="identity set"
                value={
                  /^0x0{64}$/.test(result.record.identityHash) ? (
                    <State tone="warn">cleared</State>
                  ) : (
                    hashShort(result.record.identityHash, 6, 4)
                  )
                }
                title={result.record.identityHash}
                mono={false}
              />
              <Row
                label="commitment, recomputed"
                value={
                  result.recomputedCommitment === null
                    ? 'not returned'
                    : hashShort(result.recomputedCommitment, 8, 6)
                }
                title={result.recomputedCommitment ?? undefined}
                tone={result.commitmentMatches === false ? 'bad' : 'default'}
              />
              <Row
                label="commitment, gate anchor"
                value={hashShort(result.expectedCommitment, 8, 6)}
                title={result.expectedCommitment}
                tone={result.commitmentMatches === false ? 'bad' : 'default'}
              />

              <p
                className={cn(
                  'mt-2 text-[11px] leading-4',
                  result.commitmentMatches === null
                    ? 'text-muted'
                    : result.commitmentMatches
                      ? 'text-ok'
                      : 'text-bad',
                )}
              >
                {result.commitmentMatches === null
                  ? 'The verifier did not return a commitment to compare.'
                  : result.commitmentMatches
                    ? 'The record the verifier decoded hashes to exactly the commitment this gate is anchored on.'
                    : 'The decoded record does not hash to the gate commitment, so the gate would reject this proof.'}
              </p>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}
