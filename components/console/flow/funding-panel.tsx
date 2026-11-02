'use client'

import { Loader2, RefreshCw } from 'lucide-react'

import { CopyButton } from '@/components/console/copy-button'
import { Notice, Panel, Row, State } from '@/components/console/primitives'
import { useFunding } from '@/hooks/use-flow'
import { formatUnits } from '@/lib/flow/codec'
import { NATIVE_DECIMALS } from '@/lib/flow/native'
import { hashShort } from '@/lib/format'

function tpot(value: bigint): string {
  return `${formatUnits(value, NATIVE_DECIMALS)} tPOT`
}

/**
 * The funding question the EVM address hides: tPOT is a native asset, and the
 * account it lands in is the mapped AccountId32, not the 0x address. Both the
 * SS58 encoding and the balance come from the node; nothing is derived locally
 * from the address format.
 */
export function FundingPanel({
  evmAddress,
  substrateAddress,
}: {
  evmAddress: string | null
  substrateAddress: string | null
}) {
  const funding = useFunding(evmAddress)
  const reading = funding.data

  const agrees =
    reading?.native !== null && reading?.evm !== null && reading !== null
      ? reading.native === reading.evm
      : null

  const identityMatches =
    reading?.mapped !== null &&
    reading?.mapped !== undefined &&
    substrateAddress !== null
      ? reading.mapped.ss58 === substrateAddress
      : null

  return (
    <Panel
      title="Native funding"
      hint="tPOT, mapped account"
      aside={
        evmAddress === null ? null : (
          <button
            type="button"
            onClick={() => void funding.read()}
            disabled={funding.reading}
            className="btn btn--quiet btn--sm h-7 px-2"
          >
            {funding.reading ? (
              <Loader2 className="size-3 animate-spin" strokeWidth={2} aria-hidden="true" />
            ) : (
              <RefreshCw className="size-3" strokeWidth={1.8} aria-hidden="true" />
            )}
            Re-read
          </button>
        )
      }
    >
      {evmAddress === null ? (
        <Notice title="Connect an EVM wallet first">
          The native account is derived from the EVM address, so there is nothing to map until a
          signer is connected.
        </Notice>
      ) : (
        <div>
          <p className="max-w-[52ch] text-[11.5px] leading-4 text-muted">
            Send tPOT to this SS58 address on the native chain. Funding the 0x address does not
            credit the mapped account, and this is the account the contract call will be paid from.
          </p>

          <div className="mt-3 rounded-[8px] border border-line bg-canvas px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="meta">mapped SS58 account</span>
              {reading?.mapped === null || reading?.mapped === undefined ? null : (
                <CopyButton value={reading.mapped.ss58} label="the mapped SS58 address" />
              )}
            </div>

            {funding.reading && reading === null ? (
              <p className="mt-1.5 flex items-center gap-2 text-[12px] text-muted">
                <Loader2 className="size-3.5 animate-spin" strokeWidth={2} aria-hidden="true" />
                Asking the runtime for the account id.
              </p>
            ) : reading?.mapped === null || reading?.mapped === undefined ? (
              <p className="mt-1.5 text-[11.5px] leading-4 text-warn">
                {reading?.mappedError ?? 'the runtime did not return an account id'}
              </p>
            ) : (
              <>
                <p className="mt-1.5 break-all font-mono text-[12.5px] leading-5 text-ink">
                  {reading.mapped.ss58}
                </p>
                <p className="mt-1 flex items-center gap-1 font-mono text-[10.5px] tabular-nums text-muted">
                  account id {hashShort(reading.mapped.accountId, 10, 6)}
                  <CopyButton value={reading.mapped.accountId} label="the 32 byte account id" />
                </p>
              </>
            )}
          </div>

          <div className="mt-3">
            <Row
              label="native balance"
              value={reading?.native === null || reading?.native === undefined ? '-' : tpot(reading.native)}
              title={reading?.native === null || reading?.native === undefined ? undefined : `${reading.native.toString()} planck`}
              tone={reading?.nativeError === null || reading?.nativeError === undefined ? 'default' : 'warn'}
              mono
            />
            <Row
              label="eth_getBalance"
              value={reading?.evm === null || reading?.evm === undefined ? '-' : tpot(reading.evm)}
              title={reading?.evm === null || reading?.evm === undefined ? undefined : `${reading.evm.toString()} planck`}
              tone={agrees === false ? 'warn' : 'default'}
              mono
            />
            <Row
              label="two reads"
              value={
                agrees === null ? (
                  'waiting'
                ) : agrees ? (
                  <State tone="ok">agree</State>
                ) : (
                  <State tone="warn">differ</State>
                )
              }
              mono={false}
            />
            {substrateAddress === null ? null : (
              <Row
                label="connected identity"
                value={
                  identityMatches === null ? (
                    'no mapping'
                  ) : identityMatches ? (
                    <State tone="ok">same account</State>
                  ) : (
                    <State tone="warn">different account</State>
                  )
                }
                mono={false}
              />
            )}
          </div>

          {identityMatches === false ? (
            <p className="mt-2 text-[11px] leading-4 text-warn">
              The Substrate extension shared a different account than this EVM address maps to. A
              proof signed for that native owner would not match this signer.
            </p>
          ) : null}

          {reading?.nativeError === null || reading?.nativeError === undefined ? null : (
            <p className="mt-2 font-mono text-[10.5px] leading-4 text-warn">
              ReviveApi_balance: {reading.nativeError}
            </p>
          )}
          {reading?.evmError === null || reading?.evmError === undefined ? null : (
            <p className="mt-1 font-mono text-[10.5px] leading-4 text-warn">
              eth_getBalance: {reading.evmError}
            </p>
          )}

          <p className="mt-3 border-t border-line pt-2 font-mono text-[10px] leading-4 text-muted">
            {NATIVE_DECIMALS} decimals · read at the latest state, not at a finalized root
          </p>
        </div>
      )}
    </Panel>
  )
}
