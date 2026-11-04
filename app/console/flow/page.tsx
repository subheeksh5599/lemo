'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { decodeAddress } from '@polkadot/util-crypto'
import { u8aToHex } from '@polkadot/util'

import { CopyButton } from '@/components/console/copy-button'
import { Notice, PageHeader, Panel, Row, State } from '@/components/console/primitives'
import { ScannerLink } from '@/components/console/scanner-link'
import { formatInt, hashShort } from '@/lib/format'
import { fetchPlan, formatPot } from '@/lib/live-proof'
import {
  BEEFY_FEED,
  CLAIM_STORAGE_TPOT,
  CLAIM_WEIGHT,
  encodeBurn,
  encodeClaim,
  encodeFreeze,
  encodeTransfer,
  itemProof,
  readToken,
  targetBlock,
  titleId,
  TOKEN,
  type TokenReading,
} from '@/lib/native-title'
import { scannerAccount, scannerExtrinsic } from '@/lib/scanner'
import { ensureSigner, usePortaldotWallet } from '@/lib/wallet/use-portaldot-wallet'
import {
  evmCalls,
  mappedEvm,
  nodeApi,
  signAndWatch,
  type EvmCall,
  type SignedSubmit,
  type Weight,
} from '@/lib/wallet/sign'

type Title = { collection: number; item: number }
type Outcome = { label: string; result?: SignedSubmit; error?: string }

function toEvm(to: string): string {
  const t = to.trim()
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return t
  decodeAddress(t) // throws on a bad SS58 address
  return mappedEvm(t)
}

/** LNT has 18 decimals; the tPOT formatter takes 14. */
const lnt = (raw: bigint) => formatPot(raw / 10n ** 4n)

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

function OutcomeRow({ outcome }: { outcome: Outcome | undefined }) {
  if (outcome === undefined) return null
  if (outcome.error !== undefined) return <p className="mt-3 text-[13px] text-bad">{outcome.error}</p>
  const r = outcome.result
  if (r === undefined) return null
  return (
    <div className="mt-3 space-y-1 border-t border-line pt-3">
      <Row
        label={outcome.label}
        value={
          <span className="inline-flex flex-wrap items-center gap-2">
            <State tone={r.failed === undefined ? 'ok' : 'bad'}>
              {r.failed === undefined ? 'included' : `refused on-chain: ${r.failed}`} · extrinsic {formatInt(r.blockNumber)}-{r.index}
            </State>
            <ScannerLink href={scannerExtrinsic(r.blockNumber, r.index)} label="open on the scanner" />
          </span>
        }
        mono={false}
      />
      <Row label="Extrinsic hash" value={<Hash value={r.extrinsicHash} label="the extrinsic hash" />} />
      <Row label="Fee" value={r.feePlanck === null ? '-' : `${formatPot(BigInt(r.feePlanck))} tPOT`} />
    </div>
  )
}

const btn = 'btn btn--solid btn--sm'
const field =
  'h-9 min-w-0 rounded-sm border border-line bg-canvas px-2 font-mono text-[12px] text-ink outline-none focus:border-accent'

export default function TransactPage() {
  const wallet = usePortaldotWallet()
  const { wallets, walletId, accounts, address, signer } = wallet
  const [free, setFree] = useState<bigint | null>(null)
  const [titles, setTitles] = useState<Title[]>([])
  const [selected, setSelected] = useState<Title | null>(null)
  const [reading, setReading] = useState<TokenReading | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('400')

  const evm = address === '' ? null : mappedEvm(address)

  const refresh = useCallback(async () => {
    if (address === '') return
    const api = await nodeApi()
    const [account, keys] = await Promise.all([api.query.system.account(address), api.query.nfts.account.keys(address)])
    setFree((account as unknown as { data: { free: { toBigInt: () => bigint } } }).data.free.toBigInt())
    const owned = keys
      .map((k) => {
        const args = k.args as unknown as [unknown, { toNumber: () => number }, { toNumber: () => number }]
        return { collection: args[1].toNumber(), item: args[2].toNumber() }
      })
      .sort((a, b) => b.collection - a.collection || a.item - b.item)
    setTitles(owned)
    setSelected((current) => current ?? owned[0] ?? null)
  }, [address])

  const refreshToken = useCallback(async () => {
    if (TOKEN === null) return
    try {
      setReading(await readToken(evm, selected?.collection ?? null, selected?.item ?? null))
    } catch {
      // keep the last reading
    }
  }, [evm, selected])

  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    void refreshToken()
  }, [refreshToken])

  const run = useCallback(
    async (key: string, label: string, work: () => Promise<SignedSubmit>) => {
      setActive(key)
      setOutcomes((o) => {
        const next = { ...o }
        delete next[key]
        return next
      })
      try {
        const result = await work()
        setOutcomes((o) => ({ ...o, [key]: { label, result } }))
      } catch (error) {
        setOutcomes((o) => ({ ...o, [key]: { label, error: error instanceof Error ? error.message : String(error) } }))
      } finally {
        setBusy(null)
        setActive(null)
        void refresh()
        void refreshToken()
      }
    },
    [refresh, refreshToken],
  )

  const createTitle = () =>
    run('create', 'Native title created', async () => {
      const { address, signer } = await ensureSigner()
      setBusy('Connecting to Portaldot')
      const api = await nodeApi()
      const next = (await api.query.nfts.nextCollectionId()) as unknown as { isSome: boolean; unwrap: () => { toNumber: () => number } }
      const id = next.isSome ? next.unwrap().toNumber() : 0
      const config = {
        settings: 0,
        maxSupply: null,
        mintSettings: { mintType: 'Issuer', price: null, startBlock: null, endBlock: null, defaultItemSettings: 0 },
      }
      const result = await signAndWatch(api, address, signer, [api.tx.nfts.create(address, config), api.tx.nfts.mint(id, 0, address, null)], setBusy)
      if (result.failed === undefined) setSelected({ collection: id, item: 0 })
      return result
    })

  /** Feed submissions up to the newest validator-signed block, then one token call that carries a proof at that block. */
  const withProof = async (make: (key: string, nodes: string[]) => EvmCall, weight: Weight, needsItem: boolean): Promise<SignedSubmit> => {
    if (TOKEN === null || BEEFY_FEED === null) throw new Error('This build has no NativeTitleToken or BeefyRootFeed address configured.')
    if (selected === null) throw new Error('Create a native title first (step 1), or pick one from the list.')
    const { address, signer } = await ensureSigner()
    const feed = BEEFY_FEED
    setBusy('Planning from BEEFY')
    const plan = await fetchPlan()
    const block = targetBlock(plan)
    setBusy(`Reading the native proof at #${formatInt(block)}`)
    const proof = await itemProof(selected.collection, selected.item, block)
    if (needsItem && proof.owner === null) {
      throw new Error(
        `Block #${formatInt(block)} is the newest one the validators have signed, and this title does not exist there yet. Wait about 30 seconds and press again.`,
      )
    }
    if (needsItem && proof.owner !== null && proof.owner.toLowerCase() !== u8aToHex(decodeAddress(address)).toLowerCase()) {
      throw new Error('At the newest validator-signed block this title belongs to another account, so the contract would refuse the mint.')
    }
    if (!needsItem && proof.owner !== null) {
      throw new Error(
        `The newest validator-signed block (#${formatInt(block)}) still shows the item. Wait about 30 seconds after the native burn and press again.`,
      )
    }
    const api = await nodeApi()
    setBusy('Dry-running on Portaldot')
    const calls: EvmCall[] = [...plan.steps.map((s) => ({ dest: feed, data: s.data })), make(proof.key, proof.nodes)]
    const weights: (Weight | null)[] = [...plan.steps.map(() => null), weight]
    const txs = await evmCalls(api, address, calls, weights)
    return signAndWatch(api, address, signer, txs, setBusy)
  }

  const claim = () =>
    run('claim', 'Minted against the native proof', () => {
      if (selected !== null && reading !== null && reading.balance !== null && reading.balance > 0n && reading.heldTitle !== titleId(selected.collection, selected.item)) {
        throw new Error(
          `Your EVM address still holds ${lnt(reading.balance)} LNT of an earlier title. Press "Retire my LNT" first: each holder keeps one title, so a freeze always hits exactly the right tokens.`,
        )
      }
      return withProof((key, nodes) => ({ dest: TOKEN as string, data: encodeClaim(key, nodes), storageTpot: CLAIM_STORAGE_TPOT }), CLAIM_WEIGHT, true)
    })

  const transfer = (force: boolean) =>
    run('transfer', 'Transferred', async () => {
      if (TOKEN === null) throw new Error('This build has no NativeTitleToken address configured.')
      const { address, signer } = await ensureSigner()
      const recipient = toEvm(to)
      const units = BigInt(Math.round(Number(amount) * 1e6)) * 10n ** 12n
      const api = await nodeApi()
      setBusy('Dry-running on Portaldot')
      const call = { dest: TOKEN, data: encodeTransfer(recipient, units), storageTpot: 8 }
      let txs
      try {
        txs = await evmCalls(api, address, [call])
      } catch (error) {
        if (!force) throw error
        const weight = api.createType('SpWeightsWeightV2Weight', { refTime: 3_000_000_000n, proofSize: 200_000n })
        txs = [api.tx.revive.call(call.dest, 0n, weight, 8n * 10n ** 14n, call.data)]
      }
      return signAndWatch(api, address, signer, txs, setBusy)
    })

  const burnNative = () =>
    run('native', 'Native title burned', async () => {
      if (selected === null) throw new Error('Pick a native title first.')
      const { address, signer } = await ensureSigner()
      const api = await nodeApi()
      return signAndWatch(api, address, signer, [api.tx.nfts.burn(selected.collection, selected.item)], setBusy)
    })

  const freeze = () =>
    run('freeze', 'Token frozen by a native absence proof', () =>
      withProof((key, nodes) => ({ dest: TOKEN as string, data: encodeFreeze(key, nodes), storageTpot: 2 }), CLAIM_WEIGHT, false),
    )

  const retire = () =>
    run('retire', 'LNT retired', async () => {
      if (TOKEN === null) throw new Error('This build has no NativeTitleToken address configured.')
      const { address, signer } = await ensureSigner()
      if (reading?.balance == null || reading.balance === 0n) throw new Error('This account holds no LNT.')
      const api = await nodeApi()
      setBusy('Dry-running on Portaldot')
      const txs = await evmCalls(api, address, [{ dest: TOKEN, data: encodeBurn(reading.balance), storageTpot: 1 }])
      return signAndWatch(api, address, signer, txs, setBusy)
    })

  const title = reading?.title ?? null
  const ownsSelected = selected !== null && titles.some((t) => t.collection === selected.collection && t.item === selected.item)
  const disabled = busy !== null || wallets.length === 0
  const label = (key: string, idle: string) => (active === key && busy !== null ? busy : idle)
  const connected = signer !== null && address !== ''
  const balance = reading?.balance ?? null

  const s1: StepStatus = selected !== null && ownsSelected ? 'done' : 'ready'
  const s2: StepStatus = title?.claimed ? 'done' : selected !== null && ownsSelected ? 'ready' : 'locked'
  const s3: StepStatus =
    outcomes.transfer?.result !== undefined && outcomes.transfer.result.failed === undefined
      ? 'done'
      : balance !== null && balance > 0n && title?.frozen !== true
        ? 'ready'
        : 'locked'
  const s4: StepStatus = title?.frozen ? 'done' : title?.claimed ? 'ready' : 'locked'

  return (
    <div className="space-y-5">
      <PageHeader title="Transact" meta="public Portaldot V3 · every step is an extrinsic your wallet signs" />

      {TOKEN === null || BEEFY_FEED === null ? (
        <Notice tone="warn" title="Not configured">
          This build is missing NEXT_PUBLIC_LEMO_TITLE_TOKEN or NEXT_PUBLIC_LEMO_BEEFY_FEED.
        </Notice>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <ol className="order-2 space-y-3 xl:order-1">
          <Step
            n={1}
            status={s1}
            title="Create a native title"
            what="An item in Portaldot's native nfts pallet, owned by your account. About 1.1 tPOT of deposits."
          >
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={btn} onClick={() => void createTitle()} disabled={disabled}>
                {label('create', titles.length > 0 ? 'Create another' : 'Create native title')}
              </button>
              {titles.length > 0 ? (
                <select
                  aria-label="Title"
                  value={selected === null ? '' : `${selected.collection}/${selected.item}`}
                  onChange={(e) => {
                    const [c, i] = e.target.value.split('/').map(Number)
                    setSelected({ collection: c ?? 0, item: i ?? 0 })
                  }}
                  className={field}
                >
                  {titles.map((t) => (
                    <option key={`${t.collection}/${t.item}`} value={`${t.collection}/${t.item}`}>
                      title {t.collection}/{t.item}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            <OutcomeRow outcome={outcomes.create} />
          </Step>

          <Step
            n={2}
            status={s2}
            title="Prove it and mint the EVM token"
            what="One extrinsic: the feed takes the newest validator-signed root, then NativeTitleToken walks your item's storage proof under it and mints 1,000 LNT to your mapped EVM address. Holds about 27 tPOT of storage deposit."
            hint={s2 === 'ready' ? 'Wait about 30 seconds after creating: validators sign a few blocks behind the head.' : undefined}
          >
            <button
              type="button"
              className={btn}
              onClick={() => void claim()}
              disabled={disabled || selected === null || !ownsSelected || title?.claimed === true}
            >
              {title?.claimed ? 'Minted' : label('claim', 'Prove and mint 1,000 LNT')}
            </button>
            <OutcomeRow outcome={outcomes.claim} />
          </Step>

          <Step
            n={3}
            status={s3}
            title="Transfer it"
            what="Moves while the native title is held. Send to an address that holds no LNT from an earlier title."
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label="Recipient"
                placeholder="0x… or a Portaldot SS58 address"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                spellCheck={false}
                className={`${field} min-w-[16rem] flex-1`}
              />
              <input aria-label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${field} w-24 text-right`} />
              <button type="button" className={btn} onClick={() => void transfer(false)} disabled={disabled || to.trim() === ''}>
                {label('transfer', 'Transfer')}
              </button>
            </div>
            {outcomes.transfer?.error?.includes('TitleFrozen') ? (
              <button type="button" className="btn btn--sm mt-2" onClick={() => void transfer(true)} disabled={disabled}>
                Send anyway: record the refusal on-chain
              </button>
            ) : null}
            <OutcomeRow outcome={outcomes.transfer} />
          </Step>

          <Step
            n={4}
            status={s4}
            title="Burn it natively, then freeze the token"
            what="Once the item is gone, anyone can prove its absence under a validator-signed root. Every LNT of this title freezes and transfers revert with TitleFrozen."
            hint={s4 === 'ready' ? 'Wait about 30 seconds between the burn and the freeze.' : undefined}
          >
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={btn} onClick={() => void burnNative()} disabled={disabled || selected === null || !ownsSelected}>
                {label('native', 'Burn native title')}
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => void freeze()}
                disabled={disabled || selected === null || title?.claimed !== true || title.frozen}
              >
                {title?.frozen ? 'Frozen' : label('freeze', 'Prove absence and freeze')}
              </button>
            </div>
            <OutcomeRow outcome={outcomes.native} />
            <OutcomeRow outcome={outcomes.freeze} />
          </Step>
        </ol>

        <aside className="order-1 space-y-3 xl:order-2 xl:sticky xl:top-20 xl:self-start">
          <Panel title="Wallet">
            {wallets.length === 0 ? (
              <p className="text-[13px] leading-5 text-muted">
                No Portaldot wallet extension found. Install Talisman, SubWallet or Polkadot.js and reload.
              </p>
            ) : !connected ? (
              <div className="space-y-2">
                <select aria-label="Wallet extension" value={walletId} onChange={(e) => wallet.setWalletId(e.target.value)} className={`${field} w-full`}>
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <button type="button" className={`${btn} w-full justify-center`} onClick={() => void wallet.connect()} disabled={wallet.connecting}>
                  {wallet.connecting ? 'Connecting' : 'Connect wallet'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <select
                  aria-label="Account"
                  value={address}
                  onChange={(e) => {
                    wallet.setAddress(e.target.value)
                    setSelected(null)
                  }}
                  className={`${field} w-full`}
                >
                  {accounts.map((a) => (
                    <option key={a.address} value={a.address}>
                      {a.name ? `${a.name} · ` : ''}
                      {a.address.slice(0, 8)}…{a.address.slice(-6)}
                    </option>
                  ))}
                </select>
                <dl className="space-y-2 text-[13px]">
                  <Line k="Account" v={<ScannerLink href={scannerAccount(address)} label="open on the scanner" />} />
                  <Line k="Balance" v={free === null ? '-' : `${formatPot(free)} tPOT`} />
                  <Line
                    k="EVM address"
                    v={
                      evm === null ? (
                        '-'
                      ) : (
                        <Hash value={evm} label="your mapped EVM address" />
                      )
                    }
                  />
                </dl>
              </div>
            )}
            {wallet.error !== null ? <p className="mt-3 text-[13px] text-bad">{wallet.error}</p> : null}
          </Panel>

          <Panel title="This title">
            <dl className="space-y-2 text-[13px]">
              <Line k="Native title" v={selected === null ? 'none yet' : `${selected.collection}/${selected.item}${ownsSelected ? '' : ' (gone)'}`} />
              <Line
                k="EVM token"
                v={
                  title === null ? (
                    '-'
                  ) : (
                    <State tone={title.frozen ? 'bad' : title.claimed ? 'ok' : 'idle'}>
                      {title.frozen ? 'frozen' : title.claimed ? 'minted' : 'not minted'}
                    </State>
                  )
                }
              />
              <Line k="Your LNT" v={balance === null ? '-' : lnt(balance)} />
              <Line k="LNT supply" v={reading === null ? '-' : lnt(reading.totalSupply)} />
            </dl>
            {balance !== null && balance > 0n ? (
              <button type="button" className="btn btn--sm mt-3 w-full justify-center" onClick={() => void retire()} disabled={disabled}>
                {label('retire', 'Retire my LNT')}
              </button>
            ) : null}
            <OutcomeRow outcome={outcomes.retire} />
          </Panel>

          {TOKEN !== null ? (
            <Panel title="Contracts" className="hidden xl:block">
              <dl className="space-y-2 text-[13px]">
                <Line k="NativeTitleToken" v={<Hash value={TOKEN} label="the token address" />} />
                {BEEFY_FEED !== null ? <Line k="BeefyRootFeed" v={<Hash value={BEEFY_FEED} label="the feed address" />} /> : null}
              </dl>
            </Panel>
          ) : null}
        </aside>
          {TOKEN !== null ? (
            <Panel title="Contracts" className="order-3 xl:hidden">
              <dl className="space-y-2 text-[13px]">
                <Line k="NativeTitleToken" v={<Hash value={TOKEN} label="the token address" />} />
                {BEEFY_FEED !== null ? <Line k="BeefyRootFeed" v={<Hash value={BEEFY_FEED} label="the feed address" />} /> : null}
              </dl>
            </Panel>
          ) : null}
      </div>
    </div>
  )
}

type StepStatus = 'done' | 'ready' | 'locked'

function Step({
  n,
  status,
  title,
  what,
  hint,
  children,
}: {
  n: number
  status: StepStatus
  title: string
  what: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <li
      className={`rounded-md border bg-surface p-4 transition-colors duration-150 ${
        status === 'ready' ? 'border-line-strong' : 'border-line'
      }`}
    >
      <div className="flex gap-3">
        <span
          aria-hidden="true"
          className={`flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-[12px] ${
            status === 'done'
              ? 'border-ok/40 bg-ok/10 text-ok'
              : status === 'ready'
                ? 'border-accent bg-accent/15 text-ink'
                : 'border-line text-muted'
          }`}
        >
          {status === 'done' ? <Check className="size-3.5" strokeWidth={2.4} /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 className={`text-[15px] font-medium ${status === 'locked' ? 'text-ink-2' : 'text-ink'}`}>{title}</h2>
            <span className={`font-mono text-[11px] uppercase tracking-[0.08em] ${status === 'done' ? 'text-ok' : status === 'ready' ? 'text-accent' : 'text-muted'}`}>
              {status === 'done' ? 'done' : status === 'ready' ? 'next' : 'waiting'}
            </span>
          </div>
          <p className="mt-1 max-w-[68ch] text-[13px] leading-5 text-muted">{what}</p>
          {hint !== undefined ? <p className="mt-1 text-[12px] leading-4 text-ink-2">{hint}</p> : null}
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </li>
  )
}

function Line({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-[12px] text-ink-2">{v}</dd>
    </div>
  )
}
