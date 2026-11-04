'use client'

import { useCallback, useEffect, useState } from 'react'
import { decodeAddress } from '@polkadot/util-crypto'
import { u8aToHex } from '@polkadot/util'

import { CopyButton } from '@/components/console/copy-button'
import { Figure, FigureBand, Notice, PageHeader, Panel, Row, State } from '@/components/console/primitives'
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
import {
  connectSigner,
  evmCalls,
  listSubstrateWallets,
  mappedEvm,
  nodeApi,
  signAndWatch,
  type EvmCall,
  type SignedSubmit,
  type Signer,
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
  const [wallets, setWallets] = useState<{ id: string; name: string }[]>([])
  const [walletId, setWalletId] = useState('')
  const [accounts, setAccounts] = useState<{ address: string; name?: string }[]>([])
  const [address, setAddress] = useState('')
  const [signer, setSigner] = useState<Signer | null>(null)
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

  useEffect(() => {
    const read = () => {
      const found = listSubstrateWallets()
      setWallets(found)
      setWalletId((current) => current || found[0]?.id || '')
    }
    read()
    const timer = setTimeout(read, 1200) // extensions inject after load
    return () => clearTimeout(timer)
  }, [])

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

  const connect = async () => {
    try {
      setBusy('Connecting')
      const c = await connectSigner(walletId)
      setAccounts(c.accounts)
      setAddress(c.accounts[0]?.address ?? '')
      setSigner(c.signer)
    } catch (error) {
      setOutcomes((o) => ({ ...o, connect: { label: 'Connect', error: error instanceof Error ? error.message : String(error) } }))
    } finally {
      setBusy(null)
    }
  }

  const createTitle = () =>
    run('create', 'Native title created', async () => {
      if (signer === null) throw new Error('connect a wallet first')
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
    if (signer === null || selected === null || TOKEN === null || BEEFY_FEED === null) throw new Error('connect a wallet and pick a title')
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
      if (signer === null || TOKEN === null) throw new Error('connect a wallet first')
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
      if (signer === null || selected === null) throw new Error('connect a wallet and pick a title')
      const api = await nodeApi()
      return signAndWatch(api, address, signer, [api.tx.nfts.burn(selected.collection, selected.item)], setBusy)
    })

  const freeze = () =>
    run('freeze', 'Token frozen by a native absence proof', () =>
      withProof((key, nodes) => ({ dest: TOKEN as string, data: encodeFreeze(key, nodes), storageTpot: 2 }), CLAIM_WEIGHT, false),
    )

  const retire = () =>
    run('retire', 'LNT retired', async () => {
      if (signer === null || TOKEN === null || reading?.balance == null) throw new Error('connect a wallet first')
      const api = await nodeApi()
      setBusy('Dry-running on Portaldot')
      const txs = await evmCalls(api, address, [{ dest: TOKEN, data: encodeBurn(reading.balance), storageTpot: 1 }])
      return signAndWatch(api, address, signer, txs, setBusy)
    })

  const title = reading?.title ?? null
  const ownsSelected = selected !== null && titles.some((t) => t.collection === selected.collection && t.item === selected.item)
  const disabled = busy !== null || signer === null
  const label = (key: string, idle: string) => (active === key && busy !== null ? busy : idle)

  return (
    <div className="space-y-4">
      <PageHeader title="Transact" meta="native title, validator-signed proof, EVM token: public Portaldot V3, signed by your wallet" />

      <Notice title="Every button here is a real extrinsic you sign">
        The native title is an item of Portaldot&apos;s <code>nfts</code> pallet. The EVM token mints only after
        NativeTitleToken proves you own that item against the state root both BEEFY validators signed. Burn the item
        natively and anyone can prove it; the token then freezes. Every result links to the Portaldot V3 scanner.
      </Notice>

      {TOKEN === null || BEEFY_FEED === null ? (
        <Notice tone="warn" title="Not configured">
          This build is missing NEXT_PUBLIC_LEMO_TITLE_TOKEN or NEXT_PUBLIC_LEMO_BEEFY_FEED.
        </Notice>
      ) : null}

      <Panel title="Wallet" hint="Talisman, SubWallet or Polkadot.js, holding tPOT">
        {wallets.length === 0 ? (
          <p className="text-[13px] text-muted">No Portaldot wallet extension found. Install Talisman, SubWallet or Polkadot.js and reload.</p>
        ) : signer === null ? (
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Wallet extension" value={walletId} onChange={(e) => setWalletId(e.target.value)} className={field}>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <button type="button" className={btn} onClick={() => void connect()} disabled={busy !== null}>
              {busy ?? 'Connect wallet'}
            </button>
          </div>
        ) : (
          <>
            <select
              aria-label="Account"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value)
                setSelected(null)
              }}
              className={`${field} w-full`}
            >
              {accounts.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.name ? `${a.name} · ` : ''}
                  {a.address}
                </option>
              ))}
            </select>
            <div className="mt-2">
              <Row label="Native balance" value={free === null ? '-' : `${formatPot(free)} tPOT`} />
              <Row
                label="Your EVM address"
                value={
                  <span className="inline-flex items-center gap-2">
                    {evm === null ? '-' : <Hash value={evm} label="your mapped EVM address" />}
                    <ScannerLink href={scannerAccount(address)} label="account" />
                  </span>
                }
              />
            </div>
          </>
        )}
        <OutcomeRow outcome={outcomes.connect} />
      </Panel>

      <FigureBand>
        <Figure
          label="Your native titles"
          value={signer === null ? '-' : String(titles.length)}
          note={selected === null ? 'none selected' : `collection ${selected.collection}, item ${selected.item}`}
        />
        <Figure label="Your LNT" value={reading?.balance == null ? '-' : lnt(reading.balance)} />
        <Figure
          label="Token for this title"
          value={title === null ? '-' : title.frozen ? 'frozen' : title.claimed ? 'minted' : 'not minted'}
          tone={title === null ? 'muted' : title.frozen ? 'bad' : title.claimed ? 'ok' : 'muted'}
        />
        <Figure label="LNT total supply" value={reading === null ? '-' : lnt(reading.totalSupply)} />
      </FigureBand>

      <Panel title="1. Create a native title" hint="nfts.create + nfts.mint, about 1.1 tPOT of deposits">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btn} onClick={() => void createTitle()} disabled={disabled}>
            {label('create', 'Create native title')}
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
                  collection {t.collection}, item {t.item}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <p className="mt-2 text-[12px] leading-4 text-muted">
          A real item in Portaldot&apos;s native NFT pallet, owned by your account. This is the title the EVM token obeys.
        </p>
        <OutcomeRow outcome={outcomes.create} />
      </Panel>

      <Panel title="2. Mint the EVM token against it" hint="feed update + NativeTitleToken.claim, one extrinsic">
        <button
          type="button"
          className={btn}
          onClick={() => void claim()}
          disabled={disabled || selected === null || !ownsSelected || title?.claimed === true}
        >
          {title?.claimed ? 'Already minted' : label('claim', 'Prove and mint 1,000 LNT')}
        </button>
        <p className="mt-2 text-[12px] leading-4 text-muted">
          The page plans feed submissions up to the newest block the validators signed, reads your item&apos;s read proof
          at that block, and sends both in one batch. The contract walks the proof itself and mints only to the EVM
          address your native owner account maps to. The first mint holds about 27 tPOT of storage deposit.
        </p>
        <OutcomeRow outcome={outcomes.claim} />
      </Panel>

      <Panel title="3. Transfer it" hint="allowed while the native title is held">
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Recipient"
            placeholder="recipient: 0x… or a Portaldot SS58 address"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            spellCheck={false}
            className={`${field} flex-1`}
          />
          <input aria-label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${field} w-24`} />
          <button type="button" className={btn} onClick={() => void transfer(false)} disabled={disabled || to.trim() === ''}>
            {label('transfer', 'Transfer')}
          </button>
          {outcomes.transfer?.error?.includes('TitleFrozen') ? (
            <button type="button" className="btn btn--sm" onClick={() => void transfer(true)} disabled={disabled}>
              Send anyway: record the refusal on-chain
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-[12px] leading-4 text-muted">
          Each address holds LNT of one title at a time, so a freeze always hits exactly that title&apos;s tokens. Send to
          an address that holds no LNT from an earlier title.
        </p>
        <OutcomeRow outcome={outcomes.transfer} />
      </Panel>

      <Panel title="4. Burn the title natively, then freeze the token" hint="nfts.burn, then NativeTitleToken.freeze">
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
            {title?.frozen ? 'Frozen' : label('freeze', 'Prove it and freeze')}
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => void retire()}
            disabled={disabled || reading?.balance == null || reading.balance === 0n}
          >
            {label('retire', 'Retire my LNT')}
          </button>
        </div>
        <p className="mt-2 text-[12px] leading-4 text-muted">
          Once the item is gone natively, its absence under a validator-signed root freezes every LNT of this title, and
          transfers revert with TitleFrozen. Anyone can submit that proof. Retiring LNT stays allowed.
        </p>
        <OutcomeRow outcome={outcomes.native} />
        <OutcomeRow outcome={outcomes.freeze} />
        <OutcomeRow outcome={outcomes.retire} />
      </Panel>

      {TOKEN !== null ? (
        <Panel title="Contracts" hint="Portaldot V3">
          <Row label="NativeTitleToken" value={<Hash value={TOKEN} label="the token address" />} />
          {BEEFY_FEED !== null ? <Row label="BeefyRootFeed" value={<Hash value={BEEFY_FEED} label="the feed address" />} /> : null}
        </Panel>
      ) : null}
    </div>
  )
}
