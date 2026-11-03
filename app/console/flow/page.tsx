'use client'

import { useCallback, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'

import { ActionPanel, type FlowForm } from '@/components/console/flow/action-panel'
import { DeploymentPanel } from '@/components/console/flow/deployment-panel'
import { FundingPanel } from '@/components/console/flow/funding-panel'
import { GatePanel } from '@/components/console/flow/gate-panel'
import { VerifyPanel } from '@/components/console/flow/verify-panel'
import { WalletDock } from '@/components/console/flow/wallet-dock'
import { Notice, PageHeader } from '@/components/console/primitives'
import { useWallet } from '@/components/wallet/wallet-provider'
import { useFlowSnapshot } from '@/hooks/use-flow'
import { parseProof, type ParsedProof, type ProofBinding } from '@/lib/flow/proof'
import { EXPLORER_BASE, EXPLORER_ENV, missingContracts } from '@/lib/flow/config'
import { formatInt, ms, relativeTime } from '@/lib/format'

function RefreshIcon({ reading }: { reading: boolean }) {
  return (
    <RefreshCw
      className={reading ? 'size-3.5 animate-spin' : 'size-3.5'}
      strokeWidth={1.8}
      aria-hidden="true"
    />
  )
}

const INITIAL_FORM: FlowForm = {
  operation: 'transfer',
  recipient: '',
  amount: '',
  proofText: '',
}

export default function FlowPage() {
  const snapshot = useFlowSnapshot()
  const { evmAccount, evmWallets, substrateAccount } = useWallet()

  const [form, setForm] = useState<FlowForm>(INITIAL_FORM)

  const onChange = useCallback((patch: Partial<FlowForm>) => {
    setForm((current) => ({ ...current, ...patch }))
  }, [])

  const proof = useMemo<{ parsed: ParsedProof | null; problem: string | null }>(() => {
    if (form.proofText.trim().length === 0) return { parsed: null, problem: null }
    const parsed = parseProof(form.proofText)
    return parsed.ok
      ? { parsed: parsed.proof, problem: null }
      : { parsed: null, problem: parsed.problem }
  }, [form.proofText])

  const binding = useMemo<ProofBinding | null>(() => {
    const gate = snapshot.data?.gate
    const verifier = snapshot.data?.verifier
    if (gate === null || gate === undefined || gate.state === null) return null
    if (verifier === null || verifier === undefined || verifier.state === null) return null

    return {
      titleId: gate.state.titleId,
      chainId: gate.state.boundChainId,
      token: gate.address,
      operation:
        form.operation === 'mint'
          ? verifier.state.operationMint
          : verifier.state.operationTransfer,
    }
  }, [snapshot.data, form.operation])

  const provider = useMemo(() => {
    if (evmAccount === null) return null
    return evmWallets.find((wallet) => `evm:${wallet.id}` === evmAccount.walletId)?.provider ?? null
  }, [evmAccount, evmWallets])

  const unset = missingContracts()
  const data = snapshot.data
  const paused = data?.gate?.state?.paused ?? null
  const chainLine =
    data === null
      ? 'reading the endpoint'
      : `chain ${formatInt(data.chain.chainId)}, head #${formatInt(data.chain.head)}`

  return (
    <div className="space-y-4">
      <PageHeader
        title="Transactions"
        meta={
          <>
            {chainLine}
            {data === null ? '' : `, ${ms(data.latencyMs)} to read`}
            {', '}
            {snapshot.reading
              ? 'refreshing'
              : snapshot.readAt === null
                ? 'not read yet'
                : `read ${relativeTime(snapshot.readAt)}`}
            {', '}
            {EXPLORER_BASE === null
              ? `no explorer (${EXPLORER_ENV} not set), hashes shown without links`
              : `explorer ${EXPLORER_BASE.replace(/^https?:\/\//, '')}`}
          </>
        }
        action={
          <button
            type="button"
            onClick={() => void snapshot.read()}
            disabled={snapshot.reading}
            className="btn btn--sm"
          >
            <RefreshIcon reading={snapshot.reading} />
            {snapshot.reading ? 'Reading' : 'Re-read'}
          </button>
        }
      />

      {unset.length === 0 ? (
        <Notice
          tone="warn"
          title={
            paused === false
              ? 'Gate deployed; the chain reports it unpaused'
              : 'Gate deployed and paused'
          }
        >
          <p>
            {paused === false
              ? 'The ERC-20 gate and verifier are live and the latest read shows the gate not paused. '
              : 'The ERC-20 gate and verifier are live, but the gate is paused after a burn authority fix in source. '}
            The deployed bytecode predates that fix; a redeploy is required before live use. Its
            title commitment is also a deployment placeholder, so a mint or transfer has no real
            native title proof. The page keeps the real address and the real revert path; it does
            not fake a successful transaction.
          </p>
        </Notice>
      ) : (
        <Notice tone="warn" title="Contract addresses not set">
          <p>
            This build has no address for{' '}
            <span className="font-mono text-[12px] text-ink-2">
              {unset.map((slot) => slot.env).join(', ')}
            </span>
            . The panels below stay disabled and name the variable they need. These are build time
            values: set them and run the build again.
          </p>
        </Notice>
      )}

      {snapshot.error === null ? null : (
        <Notice tone="bad" title="The EVM endpoint did not answer">
          <p className="font-mono text-[12px]">{snapshot.error}</p>
          <button type="button" className="btn btn--sm mt-2" onClick={() => void snapshot.read()}>
            Read again
          </button>
        </Notice>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)]">
        <div className="grid gap-4">
          <ActionPanel
            form={form}
            onChange={onChange}
            proof={proof}
            gate={data?.gate ?? null}
            verifier={data?.verifier ?? null}
            feed={data?.feed ?? null}
            chainId={data?.chain.chainId ?? null}
            evmAccount={evmAccount}
            walletChainId={evmAccount?.chainId ?? null}
            provider={provider}
            onSettled={() => void snapshot.read()}
          />

          <VerifyPanel
            proof={proof}
            binding={binding}
            gate={data?.gate ?? null}
            verifier={data?.verifier ?? null}
          />

          <GatePanel snapshot={data} />
        </div>

        <div className="grid gap-4">
          <DeploymentPanel snapshot={data} />
          <WalletDock />
          <FundingPanel
            evmAddress={evmAccount?.address ?? null}
            substrateAddress={substrateAccount?.address ?? null}
          />
        </div>
      </div>
    </div>
  )
}
