'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'

import { CopyButton } from '@/components/console/copy-button'
import { Panel, State } from '@/components/console/primitives'
import { useWallet, type ActiveWalletAccount } from '@/components/wallet/wallet-provider'
import { cn } from '@/lib/utils'

function Connected({
  account,
  chainLabel,
  onDisconnect,
}: {
  account: ActiveWalletAccount
  chainLabel: string
  onDisconnect: () => void
}) {
  return (
    <div className="mt-2 rounded-sm border border-line bg-canvas px-3 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[12px] text-ink-2">{account.walletName}</span>
        <button type="button" onClick={onDisconnect} className="btn btn--quiet btn--sm">
          Disconnect
        </button>
      </div>
      <div className="mt-1 flex items-center gap-1">
        <span
          title={account.address}
          className="min-w-0 truncate font-mono text-[12px] tabular-nums text-ink"
        >
          {account.address}
        </span>
        <CopyButton value={account.address} label="the connected address" className="size-6" />
      </div>
      <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted">{chainLabel}</p>
    </div>
  )
}

function ConnectList({
  wallets,
  empty,
  pendingId,
  disabled,
  onConnect,
}: {
  wallets: { id: string; name: string }[]
  empty: string
  pendingId: string | null
  disabled: boolean
  onConnect: (walletId: string) => void
}) {
  if (wallets.length === 0) {
    return <p className="mt-2 max-w-[46ch] text-[12px] leading-4 text-muted">{empty}</p>
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {wallets.map((wallet) => (
        <button
          key={wallet.id}
          type="button"
          disabled={disabled}
          onClick={() => onConnect(wallet.id)}
          className="btn btn--sm"
        >
          {pendingId === wallet.id ? (
            <Loader2 className="size-3.5 animate-spin" strokeWidth={2} aria-hidden="true" />
          ) : null}
          {wallet.name}
        </button>
      ))}
    </div>
  )
}

/**
 * Two slots, held at the same time: the EVM account that signs, and the
 * Substrate account that names the native owner. Connecting one never drops the
 * other, which is what the flow needs and what the provider now keeps.
 */
export function WalletDock() {
  const {
    evmWallets,
    substrateWallets,
    evmAccount,
    substrateAccount,
    status,
    error,
    connect,
    disconnectKind,
  } = useWallet()

  const [pendingId, setPendingId] = useState<string | null>(null)
  const busy = status === 'connecting'

  const handleConnect = async (walletId: string) => {
    setPendingId(walletId)
    try {
      await connect(walletId)
    } finally {
      setPendingId(null)
    }
  }

  return (
    <Panel
      title="Wallets"
      hint="one signer, one identity"
      aside={
        evmAccount === null ? (
          <State tone="warn">no signer</State>
        ) : (
          <State tone="ok">signer ready</State>
        )
      }
    >
      <section aria-label="EVM signer">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13px] text-ink">EVM signer</p>
          <span className="meta">signs mint and transfer</span>
        </div>
        <p className="mt-1 max-w-[52ch] text-[12px] leading-4 text-muted">
          The call is built here and signed in your extension. No key reaches this page.
        </p>

        {evmAccount === null ? (
          <ConnectList
            wallets={evmWallets.map((wallet) => ({ id: `evm:${wallet.id}`, name: wallet.name }))}
            empty="No EVM wallet announced itself in this browser. Install MetaMask, Rabby or Coinbase Wallet, then reload."
            pendingId={pendingId}
            disabled={busy}
            onConnect={(walletId) => void handleConnect(walletId)}
          />
        ) : (
          <Connected
            account={evmAccount}
            chainLabel={
              evmAccount.chainId === null ? 'chain unavailable' : `chain ${evmAccount.chainId}`
            }
            onDisconnect={() => disconnectKind('evm')}
          />
        )}
      </section>

      <section aria-label="Substrate identity" className="mt-4 border-t border-line pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13px] text-ink">Substrate identity</p>
          <span className="meta">names the native owner</span>
        </div>
        <p className="mt-1 max-w-[52ch] text-[12px] leading-4 text-muted">
          Read only: the address is shown and compared with the account this EVM address maps to.
          Nothing is signed with it.
        </p>

        {substrateAccount === null ? (
          <ConnectList
            wallets={substrateWallets.map((wallet) => ({
              id: `substrate:${wallet.id}`,
              name: wallet.name,
            }))}
            empty="No Substrate extension is injected here. Talisman, SubWallet and Polkadot.js all announce themselves on page load."
            pendingId={pendingId}
            disabled={busy}
            onConnect={(walletId) => void handleConnect(walletId)}
          />
        ) : (
          <Connected
            account={substrateAccount}
            chainLabel="SS58, prefix 42"
            onDisconnect={() => disconnectKind('substrate')}
          />
        )}
      </section>

      {error === null ? null : (
        <p
          role="alert"
          className={cn('mt-3 border-t border-line pt-3 text-[12px] leading-4 text-bad')}
        >
          {error}
        </p>
      )}
    </Panel>
  )
}
