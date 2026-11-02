/**
 * The native face of one EVM account.
 *
 * Revive maps an H160 to a 32 byte AccountId32 as the address followed by twelve
 * 0xEE bytes (`pallet-revive` AccountId32Mapper), and exposes both halves of the
 * mapping through runtime APIs. `scripts/evm-native-address.mjs` calls
 * `ReviveApi_account_id` from the shell; this file makes the same call from the
 * page so the SS58 shown is the node's own answer, not a local reimplementation
 * of the mapper.
 *
 * Balances are read, never assumed: `ReviveApi_balance` returns the native
 * balance of the mapped account as a 32 byte little-endian word, and
 * `eth_getBalance` on the same H160 returns the same number. The panel shows
 * both so the two readings can be compared.
 */

import { NATIVE_RPC, rpc } from '@/lib/chain'

import { hexToBytes, stripHex } from './codec'

/** tPOT is native to this chain with 14 decimals. See scripts/evm-native-address.mjs. */
export const NATIVE_DECIMALS = 14

/** SS58 prefix 42, the generic Substrate prefix the test network uses. */
export const SS58_PREFIX = 42

export type MappedAccount = {
  /** 32 byte account id, hex, as the runtime returned it. */
  accountId: string
  /** The same account id encoded for a Substrate address field. */
  ss58: string
}

function assertAddress(evmAddress: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(evmAddress)) {
    throw new Error(`${evmAddress} is not a 20 byte EVM address`)
  }
}

export async function readMappedAccount(evmAddress: string): Promise<MappedAccount> {
  assertAddress(evmAddress)

  const payload = await rpc<string>(NATIVE_RPC, 'state_call', [
    'ReviveApi_account_id',
    evmAddress.slice(2),
  ])

  if (typeof payload !== 'string') {
    throw new Error('the node returned no account id for this address')
  }

  const bytes = hexToBytes(payload)
  if (bytes.length !== 32) {
    throw new Error(`expected a 32 byte account id, the node returned ${bytes.length} bytes`)
  }

  const { encodeAddress } = await import('@polkadot/util-crypto')

  return {
    accountId: `0x${stripHex(payload).toLowerCase()}`,
    ss58: encodeAddress(bytes, SS58_PREFIX),
  }
}

/**
 * The native balance behind an EVM address, in planck.
 *
 * The runtime API returns the balance right-aligned in a 32 byte word; only the
 * first 16 bytes carry the u128, least significant first.
 */
export async function readNativeBalance(evmAddress: string): Promise<bigint> {
  assertAddress(evmAddress)

  const payload = await rpc<string>(NATIVE_RPC, 'state_call', [
    'ReviveApi_balance',
    evmAddress.slice(2),
  ])

  if (typeof payload !== 'string') {
    throw new Error('the node returned no balance for this address')
  }

  const bytes = hexToBytes(payload)
  if (bytes.length < 16) {
    throw new Error(`expected at least 16 bytes of balance, got ${bytes.length}`)
  }

  let value = 0n
  for (let index = 15; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index] ?? 0)
  }
  return value
}
