import { encodeAddress } from '@polkadot/util-crypto'

/**
 * Links into the Portaldot V3 Substrate scanner.
 *
 * The scanner is a hash-routed single page app: deep links are
 * `<base>/#/blocks/<n>`, `<base>/#/extrinsics/<block>-<index>` and
 * `<base>/#/accounts/<ss58>`. It does not index EVM receipts by EVM hash, but
 * every Revive transaction is a `revive.ethTransact` extrinsic, and an EVM
 * receipt's `transactionIndex` is that extrinsic's index in its block. That is
 * how an EVM receipt becomes a scanner link.
 *
 * The base comes from the environment; with it unset, no link is rendered.
 */
export const SCANNER_ENV = 'NEXT_PUBLIC_SUBSTRATE_EXPLORER'

export const SCANNER_BASE: string | null = (() => {
  const raw = (process.env.NEXT_PUBLIC_SUBSTRATE_EXPLORER ?? '').trim()
  if (raw.length === 0 || !/^https?:\/\//.test(raw)) return null
  return raw.replace(/\/+(#\/?)?$/, '')
})()

function route(path: string): string | null {
  return SCANNER_BASE === null ? null : `${SCANNER_BASE}/#${path}`
}

export function scannerBlock(block: number | null | undefined): string | null {
  if (block === null || block === undefined || !Number.isSafeInteger(block) || block < 0) return null
  return route(`/blocks/${block}`)
}

export function scannerExtrinsic(
  block: number | null | undefined,
  index: number | null | undefined,
): string | null {
  if (block === null || block === undefined || index === null || index === undefined) return null
  if (!Number.isSafeInteger(block) || !Number.isSafeInteger(index) || block < 0 || index < 0) return null
  return route(`/extrinsics/${block}-${index}`)
}

/** Revive maps an EVM address to the native account `H160 ++ 0xEE * 12`. */
export function evmToNative(address: string): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null
  const bytes = new Uint8Array(32).fill(0xee)
  for (let i = 0; i < 20; i += 1) bytes[i] = parseInt(address.slice(2 + i * 2, 4 + i * 2), 16)
  return encodeAddress(bytes, 42)
}

export function scannerAccount(address: string | null | undefined): string | null {
  if (address === null || address === undefined) return null
  const ss58 = address.startsWith('0x') ? evmToNative(address) : address
  return ss58 === null ? null : route(`/accounts/${ss58}`)
}
