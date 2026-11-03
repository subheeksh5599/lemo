'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  CaptureCheck,
  Chapter,
  EvmStepRow,
  Hash,
  NativeStepRow,
  StepList,
} from '@/components/console/local-timeline'
import { Figure, FigureBand, Notice, PageHeader, Panel, Row } from '@/components/console/primitives'
import { formatInt, hashShort } from '@/lib/format'
import {
  decodeRecord,
  evmState,
  evmStep,
  nativeStep,
  run,
  tokens,
  verifyCapture,
  type CaptureReport,
  type EvmSnapshot,
} from '@/lib/local-e2e'

type Reports = { A: CaptureReport; B: CaptureReport; C: CaptureReport; at: number; ms: number }

const DEV_AUTHORITY = run.native.devAuthority.publicKey
const UNIT = 10n ** 12n

function utc(value: string): string {
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return value
  return `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

function units(planck: string): string {
  return formatInt(Number(BigInt(planck) / UNIT))
}

function verifyAll(): Reports {
  const started = performance.now()
  const A = verifyCapture(run.proofs.A, DEV_AUTHORITY)
  const B = verifyCapture(run.proofs.B, DEV_AUTHORITY)
  const C = verifyCapture(run.proofs.C, DEV_AUTHORITY)
  return { A, B, C, at: Date.now(), ms: performance.now() - started }
}

function GateState({ state, title }: { state: EvmSnapshot; title: string }) {
  return (
    <Panel title={title} hint="read from the gate after the step">
      <div className="grid gap-x-6 sm:grid-cols-2">
        <Row label="totalSupply" value={tokens(state.totalSupply)} />
        <Row
          label="representationOutstanding"
          value={state.representationOutstanding ? 'true' : 'false'}
          tone={state.representationOutstanding ? 'warn' : 'ok'}
        />
        <Row label="Beneficiary balance" value={tokens(state.beneficiary)} />
        <Row label="Bob balance" value={tokens(state.bob)} />
        <Row label="Feed root" value={<Hash value={state.feedRoot} label="feed root" />} tone="accent" />
        <Row label="Feed block / accepted revision" value={`#${state.feedBlock} / ${state.acceptedRevision}`} />
      </div>
    </Panel>
  )
}

export default function LocalLifecyclePage() {
  const [reports, setReports] = useState<Reports | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const rerun = useCallback(() => {
    try {
      setReports(verifyAll())
      setProblem(null)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'the checks did not run')
    }
  }, [])

  // Verification runs here, in the browser, never at build time.
  useEffect(() => {
    rerun()
  }, [rerun])

  const { native, evm } = run
  const record = decodeRecord(run.proofs.A.value ?? '0x')
  const nativeFailed = native.steps.filter((s) => s.outcome === 'failed').length
  const evmReverted = evm.steps.filter((s) => s.status === 'reverted').length
  const checks =
    reports === null
      ? null
      : [reports.A, reports.B, reports.C].flatMap((r) => [r.header.ok, r.grandpa.ok, r.storageOk])
  const passed = checks === null ? 0 : checks.filter(Boolean).length

  const deploys = evm.steps.filter((s) => s.label.startsWith('deploy '))
  const refused = nativeStep('request_unbond (while live)')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Local lifecycle"
        meta={`native blocks #${run.proofs.A.header.number} to #${run.proofs.C.header.number}, anvil chain ${evm.chainId}, recorded ${utc(run.capturedAt)}`}
        action={
          <button type="button" className="btn btn--sm" onClick={rerun}>
            Re-verify in browser
          </button>
        }
      />

      <Notice tone="warn" title="A local devnet run, recorded once">
        <p>
          The native half ran on a local solochain node with pallet-lemo-title (Aura and GRANDPA, one dev
          authority, no Revive and no EVM). The EVM half ran on anvil, with the repository&apos;s real
          verifier, feed, gate and guard. Every hash below is a real extrinsic or transaction on those two
          local chains, captured by <span className="font-mono">scripts/local-e2e.mjs</span>; the headers,
          GRANDPA signatures and storage proofs are re-checked in this browser from the committed bytes.
          It is not public Portaldot: the root feed is attested by one anvil dev key and the liveness flag
          is written by sudo.
        </p>
      </Notice>

      {problem === null ? null : (
        <Notice tone="bad" title="The checks did not run">
          <p>{problem}</p>
        </Notice>
      )}

      <FigureBand className="grid-cols-2 lg:grid-cols-5">
        <Figure label="Title id" value={hashShort(native.titleId, 4, 4)} note={native.titleIdDerivation} />
        <Figure
          label="Native extrinsics"
          value={formatInt(native.steps.length)}
          note={`${nativeFailed} refused by the pallet, as intended`}
        />
        <Figure
          label="Anvil transactions"
          value={formatInt(evm.steps.length)}
          note={`${evmReverted} reverted by the contracts, as intended`}
        />
        <Figure
          label="Browser checks"
          value={checks === null ? '-' : `${passed}/${checks.length}`}
          note={reports === null ? 'running' : `header, GRANDPA and trie for 3 blocks, ${reports.ms.toFixed(0)} ms`}
          tone={checks === null ? 'muted' : passed === checks.length ? 'ok' : 'bad'}
        />
        <Figure
          label="Final state"
          value={native.titleExistsAfterFinalize ? 'title kept' : 'unbonded'}
          note={`deposit ${native.deposit.reservedAfterFinalize === '0' ? 'returned' : 'still reserved'}`}
          tone={native.titleExistsAfterFinalize ? 'warn' : 'ok'}
        />
      </FigureBand>

      <Chapter
        id="create"
        index={1}
        title="Create the title on the native chain"
        lede={
          <>
            Alice registers a title. The pallet derives the id from her account and a salt, so nobody else
            can claim it, and reserves a deposit of {units(native.deposit.reservedAfterCreate)} UNIT. She
            then names the gate address the EVM deploy will land at, and sudo marks the representation live
            (an unwritten flag would also read as live).
          </>
        }
      >
        <StepList>
          <NativeStepRow
            step={nativeStep('create_title')}
            note={
              <>
                Salt {hashShort(native.salt, 6, 4)}, title id {hashShort(native.titleId, 8, 6)}, EVM
                beneficiary {hashShort(evm.accounts.beneficiary, 6, 4)}, chain id {String(native.fields.chainId)}.
                Revision 1.
              </>
            }
          />
          <NativeStepRow
            step={nativeStep('set_representation')}
            note={<>Binds the record to {evm.predictedGate}, predicted from the deployer nonce. Revision 2.</>}
          />
          <NativeStepRow step={nativeStep('sudo set_representation_live(true)')} />
        </StepList>
      </Chapter>

      <Chapter
        id="proof-a"
        index={2}
        title="Wait for finality and capture the proof"
        lede="The script waits for a block GRANDPA has finalized, then reads its header, its stored justification and a read proof for the title's CanonicalTitles key. The three checks below run here, on the committed bytes."
      >
        <CaptureCheck report={reports?.A ?? null} devAuthority={DEV_AUTHORITY} walkOpen>
          <div className="mt-3 grid gap-x-6 border-t border-line pt-1 sm:grid-cols-2">
            <Row label="Record revision" value={record.revision.toString()} />
            <Row label="Chain id" value={record.chainId.toString()} />
            <Row label="EVM beneficiary" value={<Hash value={record.evmBeneficiary} label="beneficiary" />} />
            <Row label="EVM contract" value={<Hash value={record.evmContract} label="gate address" />} />
            <Row label="Backing" value={hashShort(record.backing, 8, 6)} title={record.backing} tone="muted" />
            <Row
              label="Identity hash"
              value={hashShort(record.identityHash, 8, 6)}
              title={record.identityHash}
              tone="muted"
            />
          </div>
        </CaptureCheck>
      </Chapter>

      <Chapter
        id="mint"
        index={3}
        title="Mint and transfer on anvil, one proof per action"
        lede={
          <>
            The gate is deployed with the record&apos;s commitment, computed by the verifier from the proven
            320 bytes. The feed attests the state root of block #{run.proofs.A.header.number}. The mint must
            be the whole cap, to the proven beneficiary, while supply is zero; the transfer carries its own
            proof, and replaying the same transfer is refused.
          </>
        }
      >
        <Panel title="Deployed" hint={`${deploys.length} contracts from ${hashShort(evm.accounts.deployer, 6, 4)}`}>
          <div className="grid gap-x-6 sm:grid-cols-2">
            {deploys.map((step) => (
              <Row
                key={step.txHash}
                label={step.label.replace('deploy ', '')}
                value={<Hash value={step.contractAddress ?? ''} label={`${step.label} address`} head={6} tail={4} />}
                title={`tx ${step.txHash}, block #${step.blockNumber}`}
              />
            ))}
            <Row label="Title commitment" value={<Hash value={evm.titleCommitment} label="title commitment" />} />
          </div>
        </Panel>
        <StepList>
          <EvmStepRow
            step={evmStep('feed.attest(root A)')}
            note={
              <>
                Root {hashShort(run.proofs.A.header.stateRoot, 8, 6)} at native block #{run.proofs.A.header.number}.
              </>
            }
          />
          <EvmStepRow
            step={evmStep('gate.mint(full cap to beneficiary)')}
            note={`${tokens(evm.maxSupply)} LEMO-L to the beneficiary named in word 4 of the proven record.`}
          />
          <EvmStepRow
            step={evmStep('gate.transfer(beneficiary -> bob)')}
            note={`${tokens(evm.transferAmount)} LEMO-L to Bob, with a transfer proof bound to this exact action.`}
          />
          <EvmStepRow
            step={evmStep('gate.transfer replayed (same action)')}
            title="gate.transfer, same action again"
            note="The same (from, to, amount) at the same revision was already used, so its nullifier is spent."
          />
        </StepList>
        <GateState state={evmState('transfer')} title="Gate after the transfer" />
      </Chapter>

      <Chapter
        id="refused"
        index={4}
        title="Unbond refused while the representation is live"
        lede="With supply outstanding on the EVM side, Alice asks the native chain to release the backing. The pallet refuses: the extrinsic is included in a block and fails with the exact error below. The EVM guard refuses for the same reason."
      >
        <StepList>
          <NativeStepRow
            step={refused}
            title="request_unbond"
            expectRefusal
            note={
              <>
                Included in block #{refused.blockNumber} and refused with {refused.error?.pallet}.
                {refused.error?.error}: RepresentationLive is Some(true), and only an explicit Some(false) lets
                an unbond start.
              </>
            }
          />
          <EvmStepRow
            step={evmStep('guard.requestUnbond (supply outstanding)')}
            title="UnbondGuard.requestUnbond"
            note="The guard reads representationOutstanding() from the gate before it looks at the proof."
          />
        </StepList>
      </Chapter>

      <Chapter
        id="burn"
        index={5}
        title="Burn the representation with a fresh finalized root"
        lede={
          <>
            A later finalized block, #{run.proofs.B.header.number}, is captured and attested; the older root
            no longer authorises anything. Bob sends his share back, and the beneficiary burns the whole cap.
            Mint and burn nullifiers are separate, so one revision allows one of each.
          </>
        }
      >
        <CaptureCheck report={reports?.B ?? null} devAuthority={DEV_AUTHORITY} />
        <StepList>
          <EvmStepRow
            step={evmStep('feed.attest(root B)')}
            note={
              <>
                Root {hashShort(run.proofs.B.header.stateRoot, 8, 6)} at native block #{run.proofs.B.header.number}.
              </>
            }
          />
          <EvmStepRow step={evmStep('gate.transfer(bob -> beneficiary)')} />
          <EvmStepRow
            step={evmStep('gate.burn(full cap)')}
            note={`${tokens(evm.maxSupply)} LEMO-L burned; totalSupply is 0.`}
          />
          <EvmStepRow
            step={evmStep('guard.requestUnbond (burn proof)')}
            title="UnbondGuard.requestUnbond"
            note="Now accepted: no supply outstanding, and a burn proof of the record at the feed's root."
          />
          <EvmStepRow
            step={evmStep('guard.completeUnbond')}
            title="UnbondGuard.completeUnbond"
            note={<>Request {hashShort(evm.guard.requestId, 6, 4)} released by the attester.</>}
          />
        </StepList>
        <GateState state={evmState('burn')} title="Gate after the burn" />
      </Chapter>

      <Chapter
        id="unbond"
        index={6}
        title="Unbond allowed on the native chain"
        lede={
          <>
            Only after the burn does sudo mirror the representation as not live. The unbond request now
            succeeds and starts a ten block period; finalizing early is refused; from block #
            {native.unbondDueBlock} anyone can finalize. The record is deleted and the deposit returned.
          </>
        }
      >
        <StepList>
          <NativeStepRow step={nativeStep('sudo set_representation_live(false)')} />
          <NativeStepRow
            step={nativeStep('request_unbond')}
            note={<>Due at block #{native.unbondDueBlock}. The title is frozen until then: no edit can bump its revision.</>}
          />
          <NativeStepRow
            step={nativeStep('finalize_unbond (before due)')}
            title="finalize_unbond, before the period"
            expectRefusal
          />
          <NativeStepRow
            step={nativeStep('finalize_unbond')}
            note={
              <>
                Signed by Bob: finalization is permissionless. Alice&apos;s reserved balance went from{' '}
                {units(native.deposit.reservedAfterCreate)} UNIT back to {units(native.deposit.reservedAfterFinalize)}.
              </>
            }
          />
        </StepList>
        <CaptureCheck report={reports?.C ?? null} devAuthority={DEV_AUTHORITY} />
      </Chapter>

      <p className="font-mono text-[11px] leading-4 text-muted">
        fixtures/local-e2e.json, replayed by local-evm/test/LocalE2E.t.sol;{' '}
        {reports === null ? 'checks pending' : `last verified ${new Date(reports.at).toISOString().slice(11, 19)} UTC`}
      </p>
    </div>
  )
}
