'use client'

import { useCallback, useMemo, useState } from 'react'
import { ArrowUpRight, Loader2 } from 'lucide-react'

import { CopyButton } from '@/components/console/copy-button'
import { Notice, Panel, Row, State } from '@/components/console/primitives'
import type { ActiveWalletAccount } from '@/components/wallet/wallet-provider'
import {
  callContract,
  describeRevert,
  gateFunction,
  sendTransaction,
  switchChain,
  waitForReceipt,
  type TxReceipt,
} from '@/lib/flow/evm'
import { encodeFunctionCall, formatUnits, parseUnits } from '@/lib/flow/codec'
import { contract, explorerTxUrl } from '@/lib/flow/config'
import { titleProofTuple, type ParsedProof, type ProofBinding } from '@/lib/flow/proof'
import type { FeedState, GateState, Probe, VerifierState } from '@/lib/flow/state'
import type { Eip1193Provider } from '@/lib/wallet/eip6963'
import { formatInt, hashShort } from '@/lib/format'
import { cn } from '@/lib/utils'

export type FlowOperation = 'transfer' | 'mint'

export type FlowForm = {
  operation: FlowOperation
  recipient: string
  amount: string
  proofText: string
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'simulating' }
  | { kind: 'wallet' }
  | { kind: 'pending'; hash: string }
  | { kind: 'settled'; hash: string; receipt: TxReceipt }
  | { kind: 'unconfirmed'; hash: string; message: string }
  | { kind: 'failed'; message: string }

const STAGE_WORD: Record<Stage['kind'], string> = {
  idle: 'Sign and send',
  simulating: 'Simulating',
  wallet: 'Waiting for the wallet',
  pending: 'Confirming',
  settled: 'Send another',
  unconfirmed: 'Send another',
  failed: 'Try again',
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="meta block pb-1.5">
      {children}
    </label>
  )
}

function OperationChoice({
  value,
  current,
  detail,
  onSelect,
  disabled,
}: {
  value: FlowOperation
  current: FlowOperation
  detail: string
  onSelect: (value: FlowOperation) => void
  disabled: boolean
}) {
  const active = value === current

  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={() => onSelect(value)}
      className={cn(
        'flex-1 rounded-[7px] border px-3 py-2 text-left transition-colors duration-150',
        active
          ? 'border-accent-line bg-accent-soft'
          : 'border-line bg-canvas hover:border-line-strong',
        disabled && 'opacity-50',
      )}
    >
      <span className={cn('block text-[12.5px]', active ? 'text-ink' : 'text-ink-2')}>
        {value === 'transfer' ? 'Transfer' : 'Mint'}
      </span>
      <span className="mt-0.5 block font-mono text-[10.5px] leading-4 text-muted">{detail}</span>
    </button>
  )
}

function TxResult({ stage }: { stage: Stage }) {
  if (stage.kind === 'idle' || stage.kind === 'simulating' || stage.kind === 'wallet') return null

  const hash = 'hash' in stage ? stage.hash : null
  const link = hash === null ? null : explorerTxUrl(hash)

  const tone =
    stage.kind === 'settled'
      ? stage.receipt.status === 'success'
        ? 'ok'
        : 'bad'
      : stage.kind === 'failed'
        ? 'bad'
        : 'warn'

  const word =
    stage.kind === 'settled'
      ? stage.receipt.status === 'success'
        ? 'included, and the call returned without reverting'
        : 'included, and the call reverted'
      : stage.kind === 'unconfirmed'
        ? 'sent, not confirmed yet'
        : 'not sent'

  return (
    <div className="mt-3 rounded-[8px] border border-line bg-canvas px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <State tone={tone}>{word}</State>

          {hash === null ? null : (
            <div className="mt-1.5 flex items-center gap-1">
              <span className="min-w-0 truncate font-mono text-[11.5px] tabular-nums text-ink">
                {hash}
              </span>
              <CopyButton value={hash} label="the transaction hash" className="size-6" />
            </div>
          )}
        </div>

        {link === null ? null : (
          <a
            href={link}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-accent-bright transition-colors duration-150 hover:text-ink"
          >
            explorer
            <ArrowUpRight className="size-3" strokeWidth={1.8} aria-hidden="true" />
          </a>
        )}
      </div>

      {stage.kind === 'settled' ? (
        <div className="mt-1">
          <Row
            label="block"
            value={`#${formatInt(stage.receipt.blockNumber)}`}
          />
          <Row label="gas used" value={formatInt(Number(stage.receipt.gasUsed))} />
          <Row label="logs" value={formatInt(stage.receipt.logs)} />
        </div>
      ) : null}

      {stage.kind === 'unconfirmed' ? (
        <p className="mt-1.5 font-mono text-[10.5px] leading-4 text-warn">{stage.message}</p>
      ) : null}

      {stage.kind === 'failed' ? (
        <p className="mt-1.5 max-w-[58ch] text-[11.5px] leading-4 text-bad">{stage.message}</p>
      ) : null}

      {hash !== null && link === null ? (
        <p className="mt-1.5 font-mono text-[10px] leading-4 text-muted">
          No explorer link: NEXT_PUBLIC_EVM_EXPLORER is not set for this build. The hash above is
          the transaction as the wallet reported it.
        </p>
      ) : null}
    </div>
  )
}

/**
 * The one place this page can change state. Everything a visitor types is
 * checked here before the wallet is asked for anything, and the check that
 * matters is the node's own simulation of the exact calldata.
 */
export function ActionPanel({
  form,
  onChange,
  proof,
  gate,
  verifier,
  feed,
  chainId,
  evmAccount,
  walletChainId,
  provider,
  onSettled,
}: {
  form: FlowForm
  onChange: (patch: Partial<FlowForm>) => void
  proof: { parsed: ParsedProof | null; problem: string | null }
  gate: Probe<GateState> | null
  verifier: Probe<VerifierState> | null
  feed: Probe<FeedState> | null
  chainId: number | null
  evmAccount: ActiveWalletAccount | null
  walletChainId: number | null
  provider: Eip1193Provider | null
  onSettled: () => void
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  const [switchError, setSwitchError] = useState<string | null>(null)

  const gateState = gate?.state ?? null
  const verifierState = verifier?.state ?? null
  const feedState = feed?.state ?? null

  const operation = useMemo(() => {
    if (verifierState === null) return null
    return form.operation === 'mint' ? verifierState.operationMint : verifierState.operationTransfer
  }, [form.operation, verifierState])

  const amount = gateState === null ? null : parseUnits(form.amount, gateState.decimals)
  const recipient = form.recipient.trim().toLowerCase()
  const boundChainId = gateState === null ? null : Number(gateState.boundChainId)

  const chainMismatch =
    evmAccount !== null &&
    walletChainId !== null &&
    boundChainId !== null &&
    walletChainId !== boundChainId

  const rootMismatch =
    proof.parsed !== null &&
    feedState !== null &&
    proof.parsed.stateRoot.toLowerCase() !== feedState.root.toLowerCase()

  const revisionStale =
    proof.parsed !== null &&
    gateState !== null &&
    proof.parsed.revision < gateState.acceptedRevision

  const gateSlot = contract('gate')

  const blocking: string[] = []

  if (gateSlot.address === null) blocking.push(`${gateSlot.env} is not set`)
  else if (gateState === null) blocking.push('the gate has not been read yet')
  else if (gate?.problem != null) blocking.push(gate.problem)

  if (gateState !== null && gateState.paused) blocking.push('the gate is paused on chain')

  if (evmAccount === null) blocking.push('connect an EVM wallet to sign')
  if (proof.problem !== null) blocking.push(proof.problem)
  if (recipient.length > 0 && !ADDRESS.test(recipient)) {
    blocking.push('the recipient is not a 20 byte address')
  }
  if (recipient.length === 0) blocking.push('enter a recipient')
  if (amount === null) blocking.push('enter an amount this token can express')
  else if (amount === 0n) blocking.push('an amount of zero would revert')

  if (operation === null) blocking.push('the verifier did not report its operation ids')
  if (rootMismatch) blocking.push('the proof was taken under a different state root than the feed holds')
  if (revisionStale) blocking.push('the proof is older than the revision this gate already accepted')

  const busy = stage.kind === 'simulating' || stage.kind === 'wallet' || stage.kind === 'pending'
  const ready = blocking.length === 0 && !busy && !chainMismatch

  const submit = useCallback(async () => {
    if (
      !ready ||
      gate === null ||
      gate.address === null ||
      gateState === null ||
      proof.parsed === null ||
      operation === null ||
      amount === null ||
      evmAccount === null ||
      provider === null
    ) {
      return
    }

    const binding: ProofBinding = {
      titleId: gateState.titleId,
      chainId: gateState.boundChainId,
      token: gate.address,
      operation,
    }

    const fn = gateFunction(form.operation === 'mint' ? 'mint' : 'transfer')
    const args = [recipient, amount, titleProofTuple(proof.parsed, binding)] as const
    const data = encodeFunctionCall(fn, [...args])

    setStage({ kind: 'simulating' })

    // The node executes the exact call from the signer's address. A gate
    // refusal is surfaced here, before the wallet is asked to pay for it.
    try {
      await callContract(gate.address, fn, [...args], evmAccount.address)
    } catch (cause) {
      setStage({
        kind: 'failed',
        message: `The node ran this call from ${hashShort(evmAccount.address, 6, 4)} and it reverted: ${describeRevert(cause)}`,
      })
      return
    }

    setStage({ kind: 'wallet' })

    let hash: string
    try {
      hash = await sendTransaction(provider, {
        from: evmAccount.address,
        to: gate.address,
        data,
      })
    } catch (cause) {
      setStage({ kind: 'failed', message: describeRevert(cause) })
      return
    }

    setStage({ kind: 'pending', hash })

    try {
      const receipt = await waitForReceipt(hash)
      setStage({ kind: 'settled', hash, receipt })
      if (receipt.status === 'success') onSettled()
    } catch (cause) {
      setStage({
        kind: 'unconfirmed',
        hash,
        message: cause instanceof Error ? cause.message : 'the receipt was not read',
      })
    }
  }, [
    ready,
    gate,
    gateState,
    proof.parsed,
    operation,
    amount,
    evmAccount,
    provider,
    form.operation,
    recipient,
    onSettled,
  ])

  const handleSwitch = useCallback(async () => {
    if (provider === null || boundChainId === null) return
    setSwitchError(null)
    const result = await switchChain(provider, boundChainId)
    if (!result.ok) setSwitchError(result.message)
  }, [provider, boundChainId])

  if (gateSlot.address === null) {
    return (
      <Panel title="Mint or transfer" hint="no contract">
        <p className="text-[12px] leading-5 text-warn">
          {gateSlot.env} is not set, so there is nothing to mint or transfer against.
        </p>
      </Panel>
    )
  }

  if (gateState === null) {
    const noCode = gate !== null && gate.codeSize === 0

    return (
      <Panel
        title="Mint or transfer"
        hint={
          gate === null
            ? 'reading the gate'
            : noCode
              ? 'no code at this address'
              : 'the gate did not answer'
        }
      >
        {gate === null ? (
          <p className="flex items-center gap-2 py-1 text-[12px] text-muted">
            <Loader2 className="size-3.5 animate-spin" strokeWidth={2} aria-hidden="true" />
            Reading the gate at {gateSlot.address}: supply, revision, chain binding.
          </p>
        ) : (
          <Notice
            tone="warn"
            title={noCode ? 'No contract at this address' : 'The gate did not answer'}
          >
            <p className="max-w-[58ch]">
              {noCode ? (
                <>
                  {gateSlot.env} points at{' '}
                  <span className="break-all font-mono text-[11px]">{gate.address}</span>, and the
                  endpoint reports no code there. Mint and transfer stay disabled until a deployed
                  address is set and this build is rebuilt.
                </>
              ) : (
                gate.problem ?? 'the gate did not answer'
              )}
            </p>
            {noCode ? null : (
              <p className="mt-1 font-mono text-[10.5px] text-muted">{gate.address}</p>
            )}
          </Notice>
        )}
      </Panel>
    )
  }

  return (
    <Panel
      title="Mint or transfer"
      hint={gateState === null ? 'reading the gate' : `${gateState.symbol}, ${gateState.decimals} decimals`}
      aside={
        gateState === null ? null : (
          <State tone={gateState.paused ? 'warn' : 'ok'}>
            {gateState.paused ? 'paused' : 'accepting calls'}
          </State>
        )
      }
    >
      <fieldset disabled={busy} className="min-w-0">
        <legend className="meta pb-1.5">operation</legend>
        <div role="radiogroup" aria-label="operation" className="flex gap-2">
          <OperationChoice
            value="transfer"
            current={form.operation}
            detail="moves your balance, needs a transfer proof"
            onSelect={(value) => onChange({ operation: value })}
            disabled={busy}
          />
          <OperationChoice
            value="mint"
            current={form.operation}
            detail="issues new supply, owner only"
            onSelect={(value) => onChange({ operation: value })}
            disabled={busy}
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <div className="min-w-0">
            <Label htmlFor="flow-recipient">recipient</Label>
            <input
              id="flow-recipient"
              value={form.recipient}
              onChange={(event) => onChange({ recipient: event.target.value })}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              placeholder="0x"
              className={cn(
                'h-10 w-full rounded-md border bg-canvas px-3 font-mono text-[12px] text-ink outline-none transition-colors duration-150 focus:border-accent',
                recipient.length > 0 && !ADDRESS.test(recipient) ? 'border-bad/60' : 'border-line',
              )}
            />
          </div>

          <div>
            <Label htmlFor="flow-amount">amount</Label>
            <input
              id="flow-amount"
              value={form.amount}
              onChange={(event) => onChange({ amount: event.target.value })}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.0"
              className={cn(
                'h-10 w-full rounded-md border bg-canvas px-3 text-right font-mono text-[12px] tabular-nums text-ink outline-none transition-colors duration-150 focus:border-accent',
                form.amount.length > 0 && amount === null ? 'border-bad/60' : 'border-line',
              )}
            />
          </div>
        </div>

        <div className="mt-3">
          <Label htmlFor="flow-proof">proof</Label>
          <textarea
            id="flow-proof"
            value={form.proofText}
            onChange={(event) => onChange({ proofText: event.target.value })}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            rows={6}
            placeholder={'{"stateRoot":"0x…","storageKey":"0x…","revision":1,"nodes":["0x…"]}'}
            className={cn(
              'w-full resize-y rounded-md border bg-canvas px-3 py-2 font-mono text-[11px] leading-5 text-ink outline-none transition-colors duration-150 focus:border-accent',
              proof.problem !== null && form.proofText.trim().length > 0
                ? 'border-bad/60'
                : 'border-line',
            )}
          />
          <p className="mt-1.5 max-w-[64ch] text-[11px] leading-4 text-muted">
            The finalized state root, the storage key of the title record and the sp-trie nodes
            between them. A raw <span className="font-mono">state_getReadProof</span> result is
            accepted as is.
            {form.proofText.trim().length > 0 && proof.problem !== null
              ? ` ${proof.problem}`
              : ''}
          </p>
        </div>

        <div className="mt-3 border-t border-line pt-2">
          <Row
            label="chain the gate is bound to"
            value={boundChainId === null ? '-' : formatInt(boundChainId)}
          />
          <Row
            label="operation id"
            value={operation === null ? '-' : String(operation)}
            title="read from the verifier's OP_TRANSFER / OP_MINT getters"
          />
          <Row
            label="title id"
            value={gateState === null ? '-' : hashShort(gateState.titleId, 8, 6)}
            title={gateState?.titleId}
          />
          <Row
            label="revision already accepted"
            value={gateState === null ? '-' : gateState.acceptedRevision.toString()}
          />
          <Row
            label="root the feed holds"
            value={feedState === null ? '-' : hashShort(feedState.root, 8, 6)}
            title={feedState?.root}
            tone={rootMismatch ? 'warn' : 'default'}
          />
          <Row
            label="root in this proof"
            value={proof.parsed === null ? '-' : hashShort(proof.parsed.stateRoot, 8, 6)}
            title={proof.parsed?.stateRoot}
            tone={rootMismatch ? 'warn' : 'default'}
          />
        </div>

        {chainMismatch ? (
          <div className="mt-3">
            <Notice tone="warn" title={`Your wallet is on chain ${walletChainId ?? '-'}, the gate on ${boundChainId ?? '-'}`}>
              <p>
                The transaction would be signed for the wrong chain. Switch the wallet, or change
                the network in the extension.
              </p>
              <button type="button" className="btn btn--sm mt-2 h-8" onClick={() => void handleSwitch()}>
                Switch to chain {boundChainId ?? '-'}
              </button>
              {switchError === null ? null : (
                <p role="alert" className="mt-2 font-mono text-[10.5px] leading-4 text-bad">
                  {switchError}
                </p>
              )}
            </Notice>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!ready}
            className="btn btn--solid"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden="true" />
            ) : null}
            {STAGE_WORD[stage.kind]}
          </button>

          <span className="min-w-0 font-mono text-[10.5px] leading-4 text-muted">
            {chainId === null ? 'chain not read' : `endpoint reports chain ${formatInt(chainId)}`}
            {amount === null || gateState === null
              ? ''
              : ` · ${formatUnits(amount, gateState.decimals)} ${gateState.symbol}`}
          </span>
        </div>

        {blocking.length === 0 ? null : (
          <ul className="mt-2 space-y-1">
            {blocking.slice(0, 4).map((reason) => (
              <li key={reason} className="text-[11px] leading-4 text-warn">
                {reason}
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <TxResult stage={stage} />
    </Panel>
  )
}
