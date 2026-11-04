'use client'

import { useCallback, useEffect, useState } from 'react'

import { CopyButton } from '@/components/console/copy-button'
import { Figure, FigureBand, Notice, PageHeader, Panel, Row, Skeleton, State } from '@/components/console/primitives'
import { ScannerLink } from '@/components/console/scanner-link'
import { BEEFY_FEED, fetchBeefyMaterial, readBeefyFeed, verifyBeefy, type BeefyFeedReading } from '@/lib/beefy'
import { formatInt, hashShort } from '@/lib/format'
import {
  encodeSubmit,
  formatPot,
  proveAccount,
  requestRelay,
  VERIFIER,
  type AccountProof,
  type RelayResult,
} from '@/lib/live-proof'
import { scannerAccount, scannerBlock } from '@/lib/scanner'

/** The relayer's native account: it always holds tPOT, so it proves a non-empty record. */
const EXAMPLE = '5HeBperF6m5AbP8TZKPnYRdBPMHNK3ebgkDH7FpPHNPBM9y1'

function Hash({ value, label }: { value: string; label: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span title={value} className="truncate font-mono text-[12px] tabular-nums">
        {hashShort(value, 10, 8)}
      </span>
      <CopyButton value={value} label={label} />
    </span>
  )
}

function FeedSection({
  feed,
  reading,
  onRelay,
  relaying,
  relay,
}: {
  feed: BeefyFeedReading | null
  reading: boolean
  onRelay: () => void
  relaying: string | null
  relay: RelayResult | null
}) {
  return (
    <Panel
      title="1. The root the EVM holds"
      hint="BeefyRootFeed on Portaldot V3, read with eth_call"
      aside={
        <button type="button" className="btn btn--solid btn--sm" onClick={onRelay} disabled={relaying !== null || BEEFY_FEED === null}>
          {relaying ?? 'Advance the feed now'}
        </button>
      }
    >
      {feed === null ? (
        reading ? (
          <Skeleton lines={4} />
        ) : (
          <p className="text-[13px] text-muted">The feed has not been read.</p>
        )
      ) : (
        <>
          <Row
            label="Feed"
            value={
              <span className="inline-flex items-center gap-2">
                <Hash value={feed.address} label="the feed address" />
                <ScannerLink href={scannerAccount(feed.address)} label="account" />
              </span>
            }
          />
          <Row label="currentRoot" value={<Hash value={feed.currentRoot} label="currentRoot" />} />
          <Row
            label="Root of block"
            value={
              <span className="inline-flex items-center gap-2">
                #{formatInt(feed.currentBlockNumber)}
                <ScannerLink href={scannerBlock(feed.currentBlockNumber)} label="block" />
              </span>
            }
          />
          <Row label="Validator set" value={feed.validatorSetId === null ? '-' : String(feed.validatorSetId)} />
          <Row
            label="Header rehashed here"
            value={feed.matches === null ? '-' : feed.matches ? 'state root matches the node header' : 'does not match'}
            tone={feed.matches === null ? 'default' : feed.matches ? 'ok' : 'bad'}
            mono={false}
          />
        </>
      )}

      {relay === null ? (
        <p className="mt-3 text-[12px] leading-4 text-muted">
          The button reads the newest BEEFY justification in this browser, builds the submit calldata and asks
          the server relayer to send it. The relayer only pays gas; the feed reverts anything the validators did
          not sign. It sends at most once every 30 blocks.
        </p>
      ) : relay.status === 'sent' ? (
        <div className="mt-3 space-y-1 border-t border-line pt-3">
          <Row label="Submitted" value={<State tone="ok">included in block #{formatInt(relay.block)}</State>} mono={false} />
          <Row label="Transaction" value={<Hash value={relay.hash} label="the transaction hash" />} />
          <Row
            label="Receipt"
            value={
              <span className="inline-flex items-center gap-2">
                <a href={`/tx/${relay.hash}`} className="font-mono text-[12px] underline underline-offset-4">
                  /tx
                </a>
                <ScannerLink href={scannerBlock(relay.block)} label="block" />
              </span>
            }
          />
          <Row label="New root" value={<Hash value={relay.root} label="the new root" />} />
          <Row label="Of block" value={`#${formatInt(relay.rootBlock)}, set ${relay.setId}`} />
        </div>
      ) : relay.status === 'current' ? (
        <p className="mt-3 text-[13px] text-muted">
          Already current: the root is {relay.behind} blocks behind the head (#{formatInt(relay.rootBlock)}). Nothing was
          sent.
        </p>
      ) : (
        <p className="mt-3 text-[13px] text-bad">Not sent: {relay.reason}</p>
      )}
    </Panel>
  )
}

export default function ProvePage() {
  const [feed, setFeed] = useState<BeefyFeedReading | null>(null)
  const [reading, setReading] = useState(false)
  const [address, setAddress] = useState(EXAMPLE)
  const [tamper, setTamper] = useState(false)
  const [proof, setProof] = useState<AccountProof | null>(null)
  const [proving, setProving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [relaying, setRelaying] = useState<string | null>(null)
  const [relay, setRelay] = useState<RelayResult | null>(null)

  const loadFeed = useCallback(async () => {
    if (BEEFY_FEED === null) return
    setReading(true)
    try {
      setFeed(await readBeefyFeed(BEEFY_FEED))
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'the feed read failed')
    } finally {
      setReading(false)
    }
  }, [])

  useEffect(() => {
    void loadFeed()
  }, [loadFeed])

  const prove = useCallback(async () => {
    setProving(true)
    setProblem(null)
    try {
      const result = await proveAccount(address.trim(), tamper)
      setProof(result)
      setFeed(result.feed)
    } catch (error) {
      setProof(null)
      setProblem(error instanceof Error ? error.message : 'the proof did not complete')
    } finally {
      setProving(false)
    }
  }, [address, tamper])

  const advance = useCallback(async () => {
    setRelay(null)
    try {
      setRelaying('Reading BEEFY')
      const material = await fetchBeefyMaterial()
      const verdict = verifyBeefy(material)
      if (!verdict.pass) {
        setRelay({ status: 'refused', reason: 'the newest justification did not pass the browser checks' })
        return
      }
      setRelaying('Submitting')
      setRelay(await requestRelay(encodeSubmit(material)))
      await loadFeed()
    } catch (error) {
      setRelay({ status: 'refused', reason: error instanceof Error ? error.message : 'the relay failed' })
    } finally {
      setRelaying(null)
    }
  }, [loadFeed])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Prove native state in the EVM"
        meta="a native Portaldot account record, proven by the deployed verifier against the validator-signed root"
      />

      <Notice title="The contract decides, not this page">
        Step 1 is the root the Revive EVM already holds, put there only with both BEEFY validators&apos; signatures. Step
        2 fetches a native storage proof at that root&apos;s block. Step 3 sends root, key and proof nodes to the
        deployed SubstrateTrieVerifier with eth_call; its return value is the verdict. Any SS58 address works.
      </Notice>

      {BEEFY_FEED === null || VERIFIER === null ? (
        <Notice tone="warn" title="Not configured">
          This build is missing NEXT_PUBLIC_LEMO_BEEFY_FEED or NEXT_PUBLIC_LEMO_VERIFIER.
        </Notice>
      ) : null}

      <FeedSection feed={feed} reading={reading} onRelay={advance} relaying={relaying} relay={relay} />

      <Panel title="2. Choose a native account" hint="System.Account, any SS58 address">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void prove()
          }}
        >
          <label htmlFor="ss58" className="sr-only">
            SS58 address
          </label>
          <input
            id="ss58"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="h-10 min-w-0 flex-1 rounded-sm border border-line bg-canvas px-3 font-mono text-[12px] text-ink outline-none transition-colors duration-150 focus:border-accent"
          />
          <label className="flex items-center gap-1.5 text-[13px] text-muted">
            <input type="checkbox" checked={tamper} onChange={(event) => setTamper(event.target.checked)} />
            flip one proof byte
          </label>
          <button type="submit" className="btn btn--solid btn--sm" disabled={proving}>
            {proving ? 'Proving' : 'Prove on-chain'}
          </button>
        </form>
        <p className="mt-2 text-[12px] text-muted">
          Prefilled with the relayer&apos;s account. Paste your own Portaldot address to prove your balance.
        </p>
      </Panel>

      {problem !== null ? (
        <Notice tone="bad" title="The proof did not complete">
          {problem}
        </Notice>
      ) : null}

      {proving && proof === null ? (
        <Panel title="3. The verifier's verdict">
          <Skeleton lines={6} />
        </Panel>
      ) : proof === null ? null : (
        <>
          <FigureBand>
            <Figure
              label="Verifier verdict"
              value={proof.status}
              tone={proof.status === 'PROVEN' ? 'ok' : 'bad'}
              note={proof.tampered ? 'one proof byte flipped in this browser' : 'returned by the contract'}
            />
            <Figure
              label="Proven free balance"
              value={proof.proven === null ? '-' : `${formatPot(proof.proven.free)} tPOT`}
              tone={proof.proven === null ? 'muted' : 'ok'}
            />
            <Figure
              label="Node says"
              value={proof.native === null ? 'no account' : `${formatPot(proof.native.free)} tPOT`}
              note={`at block #${formatInt(proof.feed.currentBlockNumber)}`}
            />
            <Figure
              label="Proven bytes = storage"
              value={proof.matches ? 'match' : 'no match'}
              tone={proof.matches ? 'ok' : 'bad'}
            />
          </FigureBand>

          <Panel title="3. The verifier's verdict" hint="SubstrateTrieVerifier.verify, executed by eth_call on Portaldot V3">
            <Row
              label="Verifier"
              value={
                <span className="inline-flex items-center gap-2">
                  <Hash value={proof.verifier} label="the verifier address" />
                  <ScannerLink href={scannerAccount(proof.verifier)} label="account" />
                </span>
              }
            />
            <Row label="Root (from the feed)" value={<Hash value={proof.feed.currentRoot} label="the root" />} />
            <Row label="Storage key" value={<Hash value={proof.key} label="the storage key" />} />
            <Row label="Proof nodes" value={`${proof.nodes.length} nodes, ${formatInt(proof.calldataBytes)} bytes of calldata`} />
            <Row
              label="Status"
              value={<State tone={proof.status === 'PROVEN' ? 'ok' : 'bad'}>{proof.status}</State>}
              mono={false}
            />
            <Row label="Proven value" value={proof.status === 'PROVEN' ? <Hash value={proof.provenValue} label="the proven value" /> : '-'} />
            {proof.proven === null ? null : (
              <>
                <Row label="Nonce" value={String(proof.proven.nonce)} />
                <Row label="Free" value={`${formatPot(proof.proven.free)} tPOT`} />
                <Row label="Reserved" value={`${formatPot(proof.proven.reserved)} tPOT`} />
              </>
            )}
            <Row
              label="Account"
              value={
                <span className="inline-flex items-center gap-2">
                  <span className="truncate font-mono text-[12px]">{proof.ss58}</span>
                  <ScannerLink href={scannerAccount(proof.ss58)} label="scanner" />
                </span>
              }
            />
          </Panel>
        </>
      )}
    </div>
  )
}
