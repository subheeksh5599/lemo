/**
 * Reads and writes against the Revive EVM endpoint.
 *
 * Every read is an `eth_call` made by this file; every write is handed to the
 * connected wallet's own provider, which builds, signs and broadcasts it. No
 * key is ever handled here and no result is assumed: a transaction is reported
 * as confirmed only after `eth_getTransactionReceipt` says so.
 */

import { EVM_RPC, rpc } from '@/lib/chain'
import type { Eip1193Provider } from '@/lib/wallet/eip6963'

import { FEED_ABI, GATE_ABI, VERIFIER_ABI } from './abi'
import {
  decodeErrorArguments,
  decodeFunctionResult,
  encodeFunctionCall,
  hexToBytes,
  stripHex,
  type AbiEntry,
  type AbiError,
  type AbiFunction,
  type CallArgument,
} from './codec'

const ERROR_ABI = [...GATE_ABI, ...VERIFIER_ABI, ...FEED_ABI].filter(
  (entry): entry is AbiError => entry.type === 'error',
)

export function gateFunction(name: string): AbiFunction {
  return findFunction(GATE_ABI, name)
}

export function verifierFunction(name: string): AbiFunction {
  return findFunction(VERIFIER_ABI, name)
}

export function feedFunction(name: string): AbiFunction {
  return findFunction(FEED_ABI, name)
}

function findFunction(abi: readonly AbiEntry[], name: string): AbiFunction {
  const entry = abi.find(
    (candidate): candidate is AbiFunction =>
      candidate.type === 'function' && 'name' in candidate && candidate.name === name,
  )
  if (entry === undefined) throw new Error(`${name} is not in the compiled ABI`)
  return entry
}

function revertPayload(cause: unknown): string | null {
  if (!(cause instanceof Error)) return null
  const raw = (cause as Error & { data?: unknown }).data

  if (typeof raw === 'string') return raw
  if (typeof raw === 'object' && raw !== null && 'data' in raw) {
    const nested = (raw as { data?: unknown }).data
    if (typeof nested === 'string') return nested
  }
  return null
}

function decodeSolidityString(payload: string): string | null {
  try {
    const body = stripHex(payload).slice(8)
    const length = Number(BigInt(`0x${body.slice(64, 128)}`))
    const bytes = hexToBytes(body.slice(128, 128 + length * 2))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/**
 * Turns a node error into the contract's own words. A custom error is reported
 * by name and arguments, because "execution reverted" alone hides which gate
 * binding failed.
 */
export function describeRevert(cause: unknown): string {
  const payload = revertPayload(cause)

  if (payload !== null && payload.length >= 10) {
    const selector = payload.slice(0, 10).toLowerCase()

    const match = ERROR_ABI.find((entry) => entry.selector === selector)
    if (match !== undefined) {
      try {
        const args = decodeErrorArguments(match, payload)
        const rendered = args.map((value) =>
          typeof value === 'bigint' ? value.toString() : String(value),
        )
        return `${match.name}(${rendered.join(', ')})`
      } catch {
        return match.name
      }
    }

    if (selector === '0x08c379a0') {
      const message = decodeSolidityString(payload)
      if (message !== null && message.length > 0) return message
    }

    if (selector === '0x4e487b71') {
      const code = Number(BigInt(`0x${stripHex(payload).slice(8, 72)}`))
      return `Solidity panic 0x${code.toString(16)}`
    }

    return `reverted with ${payload.slice(0, 10)}`
  }

  const message = cause instanceof Error ? cause.message : String(cause)
  const split = message.indexOf(': ')
  return split === -1 ? message : message.slice(split + 2)
}

/** eth_call at the latest block, with the revert decoded when it fails. */
export async function callContract(
  to: string,
  fn: AbiFunction,
  args: readonly CallArgument[] = [],
  from?: string,
): Promise<readonly unknown[]> {
  const data = encodeFunctionCall(fn, args)
  const request: Record<string, string> = { to, data }
  if (from !== undefined) request.from = from

  let payload: string
  try {
    payload = await rpc<string>(EVM_RPC, 'eth_call', [request, 'latest'])
  } catch (cause) {
    throw new Error(describeRevert(cause))
  }

  return decodeFunctionResult(fn, payload)
}

async function readFirst(
  to: string,
  fn: AbiFunction,
  args: readonly CallArgument[] = [],
): Promise<unknown> {
  const values = await callContract(to, fn, args)
  return values[0]
}

export async function readUint(to: string, fn: AbiFunction, args?: readonly CallArgument[]) {
  return BigInt((await readFirst(to, fn, args)) as bigint)
}

export async function readBool(to: string, fn: AbiFunction, args?: readonly CallArgument[]) {
  return (await readFirst(to, fn, args)) === true
}

export async function readAddress(to: string, fn: AbiFunction) {
  return String(await readFirst(to, fn)).toLowerCase()
}

export async function readBytes32(to: string, fn: AbiFunction) {
  return String(await readFirst(to, fn)).toLowerCase()
}

export async function readString(to: string, fn: AbiFunction) {
  return String(await readFirst(to, fn))
}

/** How much code lives at an address. Zero means nothing was deployed there. */
export async function readCodeSize(address: string): Promise<number> {
  const code = await rpc<string>(EVM_RPC, 'eth_getCode', [address, 'latest'])
  return Math.max(0, (stripHex(code).length) / 2)
}

/** The chain the endpoint reports, read now rather than assumed. */
export async function readChain(): Promise<{ chainId: number; head: number }> {
  const [chainIdHex, headHex] = await Promise.all([
    rpc<string>(EVM_RPC, 'eth_chainId'),
    rpc<string>(EVM_RPC, 'eth_blockNumber'),
  ])

  return {
    chainId: Number(BigInt(chainIdHex)),
    head: Number(BigInt(headHex)),
  }
}

export async function readBalance(address: string): Promise<bigint> {
  return BigInt(await rpc<string>(EVM_RPC, 'eth_getBalance', [address, 'latest']))
}

/* ---- writes ------------------------------------------------------------- */

export type TxReceipt = {
  status: 'success' | 'reverted'
  blockNumber: number
  gasUsed: bigint
  logs: number
}

export type PendingTx = {
  hash: string
  receipt: TxReceipt | null
}

function walletMessage(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const code = (cause as { code?: unknown }).code
    if (code === 4001) return 'You declined the transaction in the wallet.'
    if (code === -32603) {
      const data = (cause as { data?: { message?: string } }).data
      if (typeof data?.message === 'string') return data.message
    }
    const message = (cause as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) {
      const split = message.indexOf(': ')
      return split === -1 ? message : message.slice(split + 2)
    }
  }
  if (cause instanceof Error) return cause.message
  return 'the wallet did not send the transaction'
}

/**
 * Ask the wallet to send it. The wallet owns signing; what comes back is a hash
 * the wallet itself produced, and the receipt is read from the endpoint.
 */
export async function sendTransaction(
  provider: Eip1193Provider,
  request: { from: string; to: string; data: string },
): Promise<string> {
  try {
    const hash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ from: request.from, to: request.to, data: request.data }],
    })

    if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new Error('the wallet returned no transaction hash')
    }
    return hash
  } catch (cause) {
    throw new Error(walletMessage(cause))
  }
}

/**
 * Poll for a receipt. A hash is not a confirmation: this resolves only when the
 * node has included the transaction in a block, and it reports a revert as a
 * reverted receipt rather than as success.
 */
export async function waitForReceipt(
  hash: string,
  options: { timeoutMs?: number; intervalMs?: number; onPoll?: (attempt: number) => void } = {},
): Promise<TxReceipt> {
  const timeoutMs = options.timeoutMs ?? 90_000
  const intervalMs = options.intervalMs ?? 2_500
  const deadline = Date.now() + timeoutMs

  for (let attempt = 1; Date.now() < deadline; attempt += 1) {
    options.onPoll?.(attempt)

    const receipt = await rpc<{
      status?: string
      blockNumber?: string
      gasUsed?: string
      logs?: unknown[]
    } | null>(EVM_RPC, 'eth_getTransactionReceipt', [hash])

    if (receipt !== null) {
      return {
        status: BigInt(receipt.status ?? '0x0') === 1n ? 'success' : 'reverted',
        blockNumber: Number(BigInt(receipt.blockNumber ?? '0x0')),
        gasUsed: BigInt(receipt.gasUsed ?? '0x0'),
        logs: receipt.logs?.length ?? 0,
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(
    `no receipt after ${Math.round(timeoutMs / 1000)}s. The hash is real and may still confirm; check it on the explorer.`,
  )
}

/**
 * Move the wallet onto the chain the contract is bound to. Switching only: a
 * chain that is not in the wallet is reported as such, with the endpoint it
 * would need to be added with, rather than guessed at.
 */
export async function switchChain(
  provider: Eip1193Provider,
  chainId: number,
): Promise<{ ok: boolean; message: string | null }> {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    })
    return { ok: true, message: null }
  } catch (cause) {
    const code =
      typeof cause === 'object' && cause !== null ? (cause as { code?: unknown }).code : null

    if (code === 4902) {
      return {
        ok: false,
        message: `Chain ${chainId} is not in this wallet. Add it with the endpoint ${EVM_RPC.replace(
          /^https?:\/\//,
          '',
        )}, then reload.`,
      }
    }

    return { ok: false, message: walletMessage(cause) }
  }
}
