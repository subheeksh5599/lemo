'use client'

import { Notice, Panel, Row, State } from '@/components/console/primitives'
import { ROOT_SOURCE_LABEL, rootSourceKind } from '@/components/console/root-source'
import { formatUnits } from '@/lib/flow/codec'
import { contract } from '@/lib/flow/config'
import type { FlowSnapshot } from '@/lib/flow/snapshot'
import { formatInt, hashShort } from '@/lib/format'

/**
 * The gate's own account of itself, and whether it points at the verifier and
 * feed this build was configured with. A mismatch is shown as a mismatch: it is
 * the difference between "the deployment is what the page says" and "the page
 * is talking to two different deployments".
 */
export function GatePanel({ snapshot }: { snapshot: FlowSnapshot | null }) {
  const gate = snapshot?.gate ?? null
  const verifier = snapshot?.verifier ?? null
  const feed = snapshot?.feed ?? null
  const state = gate?.state ?? null

  const configuredVerifier = contract('verifier')
  const configuredFeed = contract('feed')

  const verifierMismatch =
    state === null ||
    configuredVerifier.address === null ||
    state.verifier.toLowerCase() !== configuredVerifier.address.toLowerCase()

  const feedMismatch =
    state === null ||
    configuredFeed.address === null ||
    state.feed.toLowerCase() !== configuredFeed.address.toLowerCase()

  return (
    <Panel
      title="Gate state"
      hint={
        state === null
          ? gate === null
            ? 'reading'
            : gate.codeSize === 0
              ? 'no code at this address'
              : 'did not answer'
          : `${state.name} (${state.symbol})`
      }
      aside={
        state === null ? null : (
          <State tone={state.paused ? 'warn' : 'ok'}>
            {state.paused ? 'paused' : 'live'}
          </State>
        )
      }
    >
      {state === null ? (
        gate === null ? (
          <p className="text-[12px] leading-5 text-warn">
            NEXT_PUBLIC_LEMO_GATE is not set, so there is no gate to read.
          </p>
        ) : (
          <Notice
            tone="warn"
            title={gate.codeSize === 0 ? 'No contract at this address' : 'No gate state'}
          >
            {gate.codeSize === 0 ? (
              <>
                No code at{' '}
                <span className="break-all font-mono text-[11px]">{gate.address}</span>. The
                address is configured, the contract is not deployed.
              </>
            ) : (
              (gate.problem ?? 'the gate did not answer')
            )}
          </Notice>
        )
      ) : (
        <>
          <Row
            label="Total supply"
            value={`${formatUnits(state.totalSupply, state.decimals)} ${state.symbol}`}
            title={`${state.totalSupply.toString()} base units`}
          />
          <Row
            label="Accepted revision"
            value={state.acceptedRevision.toString()}
            title="the highest revision a proof has been accepted at"
          />
          <Row
            label="Representation outstanding"
            value={
              state.outstanding ? (
                <State tone="ok">yes</State>
              ) : (
                <State tone="warn">none</State>
              )
            }
            mono={false}
          />
          <Row label="Owner" value={hashShort(state.owner, 6, 4)} title={state.owner} />
          <Row
            label="Title commitment"
            value={hashShort(state.titleCommitment, 8, 6)}
            title={state.titleCommitment}
          />
          <Row
            label="Verifier it points at"
            value={hashShort(state.verifier, 6, 4)}
            title={state.verifier}
            tone={verifierMismatch ? 'warn' : 'default'}
          />
          <Row
            label="Feed it points at"
            value={hashShort(state.feed, 6, 4)}
            title={state.feed}
            tone={feedMismatch ? 'warn' : 'default'}
          />

          {verifierMismatch || feedMismatch ? (
            <p className="mt-2 text-[11px] leading-4 text-warn">
              {verifierMismatch ? 'The gate verifier' : 'The gate feed'} is not the address this
              build configured. One of the two variables points at a different deployment than the
              gate was constructed with.
            </p>
          ) : null}

          <div className="mt-3 border-t border-line pt-2">
            <Row
              label="Feed root"
              value={feed?.state === null || feed?.state === undefined ? '-' : hashShort(feed.state.root, 8, 6)}
              title={feed?.state?.root}
            />
            <Row
              label="Feed block"
              value={
                feed?.state === null || feed?.state === undefined
                  ? '-'
                  : `#${formatInt(Number(feed.state.blockNumber))}`
              }
            />
            <Row
              label="Pinned"
              value={
                feed?.state === null || feed?.state === undefined ? (
                  '-'
                ) : feed.state.pinned ? (
                  <State tone="warn">pinned</State>
                ) : (
                  <State tone="ok">advancing</State>
                )
              }
              mono={false}
            />
            <Row
              label="Root source"
              value={
                feed?.state === null || feed?.state === undefined
                  ? '-'
                  : ROOT_SOURCE_LABEL[rootSourceKind(feed.state)]
              }
              tone={feed?.state?.attester == null ? 'default' : 'warn'}
              mono={false}
            />
            <Row
              label="Attester"
              value={
                feed?.state === null || feed?.state === undefined || feed.state.attester === null
                  ? 'none'
                  : hashShort(feed.state.attester, 6, 4)
              }
              title={feed?.state?.attester ?? undefined}
              mono={feed?.state?.attester !== null}
            />
            <Row
              label="Verifier code"
              value={
                verifier === null || verifier.codeSize === 0
                  ? 'none at this address'
                  : `${formatInt(verifier.codeSize)} bytes`
              }
              tone={verifier === null || verifier.codeSize === 0 ? 'warn' : 'default'}
            />
          </div>

          <p className="mt-2 font-mono text-[11px] leading-4 text-muted">
            read at the latest block · {snapshot === null ? '-' : `head #${formatInt(snapshot.chain.head)}`}
          </p>
        </>
      )}
    </Panel>
  )
}
