/**
 * Live readings from Portaldot V3 runtimes.
 *
 * Every displayed value on the console comes from a node call made by this
 * file. Nothing here is fixture data and nothing is derived from the
 * repository's design documents.
 *
 * What *is* hardcoded: the endpoint defaults and the expected network
 * identity, both below, both overridable from the environment. They are
 * configuration constants used for comparison, never rendered as a reading.
 * The console compares the live genesis and chain id against them and reports
 * the result as a check.
 *
 * The public endpoints drop connections above roughly two concurrent calls, so
 * every read goes through one queue with at most MAX_IN_FLIGHT simultaneous
 * calls and retries on network errors and 429/503.
 */

import {
  decodeStorageValue,
  storageKey,
  toHex,
  verifyProof,
  type DecodedValue,
  type ProofVerification,
} from './proofs'

export { toHex }

/* ---- configuration constants, not readings ------------------------------ */

/** Endpoint defaults. Override with NEXT_PUBLIC_NATIVE_RPC to read a fork. */
export const NATIVE_RPC =
  process.env.NEXT_PUBLIC_NATIVE_RPC ?? 'https://test-node-v3.portaldot.dev'

/** Endpoint defaults. Override with NEXT_PUBLIC_EVM_RPC to read a fork. */
export const EVM_RPC =
  process.env.NEXT_PUBLIC_EVM_RPC ?? 'https://test-evm-rpc-v3.portaldot.dev'

/**
 * Constant: the genesis hash this build expects to be talking to. A live
 * genesis mismatch is reported as a failed check, never as an error.
 */
export const EXPECTED_GENESIS =
  process.env.NEXT_PUBLIC_GENESIS_HASH ??
  '0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd'

/** Constant: the Revive chain id this build expects. Compared, never shown as a reading. */
export const EXPECTED_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_CHAIN_ID ?? 420420777,
)

const TIMEOUT_MS = 15_000

/** Constant: how many calls this build holds open at once. */
export const MAX_IN_FLIGHT = 2

type RpcEnvelope<T> = {
  result?: T
  error?: { code?: number; message?: string; data?: unknown }
}

let inFlight = 0
const waiting: (() => void)[] = []

async function acquire() {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight += 1
    return
  }
  await new Promise<void>((resolve) => waiting.push(resolve))
  inFlight += 1
}

function release() {
  inFlight -= 1
  waiting.shift()?.()
}

/** Jittered wait. A run of 503s is paced harder: retrying fast re-enters the same window. */
let busyStreak = 0

function resetBusyStreak() {
  busyStreak = 0
}

function retryDelay(attempt: number, busy: boolean): number {
  const jitter = Math.round(Math.random() * 180)

  if (busy && busyStreak >= 2) {
    const step = [1_000, 2_000, 4_000][Math.min(busyStreak - 2, 2)] ?? 4_000
    return step + jitter
  }

  return Math.min(1_400, 220 * attempt) + jitter
}

/**
 * One JSON-RPC call through the shared queue. Exported for the flow console,
 * which makes the same kind of read against a contract address.
 */
export async function rpc<T>(
  url: string,
  method: string,
  params: readonly unknown[] = [],
  attempt = 1,
): Promise<T> {
  await acquire()

  let status = 0
  let payload: RpcEnvelope<T> | null = null
  let transportError: unknown = null

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    status = response.status

    if (response.ok) {
      payload = (await response.json()) as RpcEnvelope<T>
    }
  } catch (cause) {
    transportError = cause
  } finally {
    // The slot is released after the body is read, not after the headers.
    release()
  }

  if (transportError !== null || status === 0) {
    if (attempt < 8) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt, false)))
      return rpc(url, method, params, attempt + 1)
    }

    throw new Error(
      `${method}: the endpoint did not accept the connection${
        transportError instanceof Error ? ` (${transportError.message})` : ''
      }`,
    )
  }

  if (status === 429 || status === 503) {
    busyStreak += 1

    if (attempt < 8) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt, true)))
      return rpc(url, method, params, attempt + 1)
    }

    throw new Error(`${method}: HTTP ${status}`)
  }

  resetBusyStreak()

  if (status >= 400) {
    throw new Error(`${method}: HTTP ${status}`)
  }

  if (payload === null) {
    throw new Error(`${method}: response carried no body`)
  }

  if (payload.error) {
    // Keep the revert payload: a contract refusal is only readable through it.
    const failure = new Error(
      `${method}: ${payload.error.message ?? 'the call was rejected'}`,
    ) as Error & { data?: unknown }
    failure.data = payload.error.data
    throw failure
  }

  if (!('result' in payload)) {
    throw new Error(`${method}: response carried no result`)
  }

  return payload.result as T
}

type RawHeader = { number: string; parentHash: string; stateRoot: string }

export type NativeHead = {
  chain: string
  genesis: string
  best: number
  finalized: {
    number: number
    hash: string
    parentHash: string
    stateRoot: string
  }
  latencyMs: number
  readAt: number
}

export async function readNativeHead(): Promise<NativeHead> {
  const started = Date.now()

  const [chain, genesis, finalizedHash, bestHash] = await Promise.all([
    rpc<string>(NATIVE_RPC, 'system_chain'),
    rpc<string>(NATIVE_RPC, 'chain_getBlockHash', [0]),
    rpc<string>(NATIVE_RPC, 'chain_getFinalizedHead'),
    rpc<string>(NATIVE_RPC, 'chain_getBlockHash'),
  ])

  const [finalizedHeader, bestHeader] = await Promise.all([
    rpc<RawHeader>(NATIVE_RPC, 'chain_getHeader', [finalizedHash]),
    rpc<RawHeader>(NATIVE_RPC, 'chain_getHeader', [bestHash]),
  ])

  return {
    chain,
    genesis,
    best: Number.parseInt(bestHeader.number, 16),
    finalized: {
      number: Number.parseInt(finalizedHeader.number, 16),
      hash: finalizedHash,
      parentHash: finalizedHeader.parentHash,
      stateRoot: finalizedHeader.stateRoot,
    },
    latencyMs: Date.now() - started,
    readAt: Date.now(),
  }
}

export type EvmHead = {
  chainId: number
  head: number
  stateRoot: string | null
  blockHash: string | null
  latencyMs: number
}

export async function readEvmHead(): Promise<EvmHead> {
  const started = Date.now()

  const [chainIdHex, blockNumberHex] = await Promise.all([
    rpc<string>(EVM_RPC, 'eth_chainId'),
    rpc<string>(EVM_RPC, 'eth_blockNumber'),
  ])

  let stateRoot: string | null = null
  let blockHash: string | null = null

  try {
    const block = await rpc<{ hash?: string; stateRoot?: string } | null>(
      EVM_RPC,
      'eth_getBlockByNumber',
      ['finalized', false],
    )
    stateRoot = block?.stateRoot ?? null
    blockHash = block?.hash ?? null
  } catch {
    // The head still stands without the block body; the page shows what came back.
  }

  return {
    chainId: Number(BigInt(chainIdHex)),
    head: Number(BigInt(blockNumberHex)),
    stateRoot,
    blockHash,
    latencyMs: Date.now() - started,
  }
}

/** Reads the timestamp inherent out of a block's first extrinsic. */
export function decodeBlockTimestamp(hex: string): number | null {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex
  // One byte length, one version byte, pallet index, call index, compact u64.
  if (body.length < 12) return null
  if (body.slice(2, 4) !== '04' && body.slice(2, 4) !== '05') return null

  const first = Number.parseInt(body.slice(8, 10), 16)
  const mode = first & 0b11

  const read = (bytes: number) => {
    const slice = body.slice(10, 10 + bytes * 2)
    if (slice.length !== bytes * 2) return 0
    return Number.parseInt(slice.match(/.{2}/g)!.reverse().join(''), 16)
  }

  if (mode === 0b00) return read(1) >>> 2
  if (mode === 0b01) return read(2) >>> 2
  if (mode === 0b10) return read(4) >>> 2
  if (mode === 0b11) return read((first >> 2) + 4)

  return null
}

export type NativeBlock = {
  number: number
  hash: string
  timestamp: number
  intervalMs: number | null
  extrinsics: number
  stateRoot: string
}

/**
 * Reads the last `count` finalized blocks by walking parent hashes down from
 * the finalized head. One call per block, one block per call: the public
 * endpoints refuse bursts, and a walk cannot be fanned out anyway.
 *
 * A block that cannot be read ends the walk with whatever was already
 * collected, so a partial window renders rather than an empty one.
 */
export async function readNativeBlocks(
  count = 16,
  onProgress?: (blocks: NativeBlock[]) => void,
): Promise<NativeBlock[]> {
  const finalizedHash = await rpc<string>(NATIVE_RPC, 'chain_getFinalizedHead')

  const rows: NativeBlock[] = []
  let hash: string | null = finalizedHash

  for (let index = 0; index < count && hash !== null; index += 1) {
    let block: { block: { header: RawHeader; extrinsics: string[] } } | null

    try {
      block = await rpc<{ block: { header: RawHeader; extrinsics: string[] } } | null>(
        NATIVE_RPC,
        'chain_getBlock',
        [hash],
      )
    } catch {
      break
    }

    if (block === null) break

    const parentBlock: { header: RawHeader; extrinsics: string[] } = block.block
    const extrinsics: string[] = parentBlock.extrinsics
    const blockHeader: RawHeader = parentBlock.header
    const first: string | undefined = extrinsics[0]
    const timestamp = first === undefined ? null : decodeBlockTimestamp(first)

    rows.push({
      number: Number.parseInt(blockHeader.number, 16),
      hash,
      timestamp: timestamp ?? 0,
      extrinsics: extrinsics.length,
      stateRoot: blockHeader.stateRoot,
      intervalMs: null,
    })

    onProgress?.(withIntervals(rows))

    if (/^0x0+$/.test(blockHeader.parentHash)) break
    hash = blockHeader.parentHash
  }

  const readable = rows.filter((block) => block.timestamp > 0)

  if (readable.length === 0) {
    throw new Error('the node returned no readable blocks')
  }

  return withIntervals(readable)
}

/** Oldest first, with the slot between neighbours that survived the walk. */
function withIntervals(blocks: NativeBlock[]): NativeBlock[] {
  return blocks
    .filter((block) => block.timestamp > 0)
    .sort((left, right) => left.number - right.number)
    .map((block, index, list) => {
      const previous = index === 0 ? undefined : list[index - 1]
      return {
        ...block,
        intervalMs:
          previous === undefined || previous.number !== block.number - 1
            ? null
            : block.timestamp - previous.timestamp,
      }
    })
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
    : (sorted[middle] ?? null)
}

/** The storage key the console proves by default: System.Number, twox128 halves. */
export const SYSTEM_NUMBER_KEY = storageKey('System', 'Number')

export type ProofNodeReading = {
  hash: string
  bytes: number
  kind: string
  nibbles: string
  depth: number
  children: number
  via: 'root' | 'hash' | 'inline'
  matched: number
}

export type StorageProof = {
  key: string
  blockNumber: number
  blockHash: string
  stateRoot: string
  proofNodes: number
  proofBytes: number
  /** the value the node serves through state_getStorage at the same hash */
  storageValue: string | null
  /** the value the trie walk proved, which should equal storageValue */
  provenValue: string | null
  valueBytes: number
  storageMatches: boolean
  decoded: DecodedValue | null
  verification: ProofVerification
  nodes: ProofNodeReading[]
  fetchedAt: number
  latencyMs: number
}

/**
 * Fetch a read proof and the storage value at the same finalized block, then
 * verify the walk here. The two reads are independent: the proof is checked
 * against the header's state root, and the proven value is compared to
 * state_getStorage, so a decoder bug cannot pass as a valid witness.
 */
export async function readStorageProof(key: string): Promise<StorageProof> {
  const started = Date.now()

  const finalizedHash = await rpc<string>(NATIVE_RPC, 'chain_getFinalizedHead')
  const header = await rpc<RawHeader>(NATIVE_RPC, 'chain_getHeader', [finalizedHash])
  const blockNumber = Number.parseInt(header.number, 16)

  const [proof, storageValue] = await Promise.all([
    rpc<{ at?: string; proof?: string[]; nodes?: string[] }>(
      NATIVE_RPC,
      'state_getReadProof',
      [[key], finalizedHash],
    ),
    rpc<string | null>(NATIVE_RPC, 'state_getStorage', [key, finalizedHash]),
  ])

  const nodes = proof.proof ?? proof.nodes ?? []
  const verification = verifyProof(key, nodes, header.stateRoot)

  return {
    key,
    blockNumber,
    blockHash: finalizedHash,
    stateRoot: header.stateRoot,
    proofNodes: nodes.length,
    proofBytes: nodes.reduce((total, node) => total + Math.max(0, (node.length - 2) / 2), 0),
    storageValue,
    provenValue: verification.valueHex,
    valueBytes: verification.valueBytes,
    storageMatches:
      verification.valueHex !== null &&
      storageValue !== null &&
      verification.valueHex.toLowerCase() === storageValue.toLowerCase(),
    decoded: decodeStorageValue(verification.valueHex),
    verification,
    nodes: verification.steps.map((step) => ({
      hash: step.hash,
      bytes: step.bytes,
      kind: step.kind,
      nibbles: step.nibbles,
      depth: step.depth,
      children: step.children,
      via: step.via,
      matched: step.matched,
    })),
    fetchedAt: Date.now(),
    latencyMs: Date.now() - started,
  }
}

export type NativeWitness = StorageProof & {
  keyLabel: string
  expectedNumber: number
  valueIsHead: boolean
}

/**
 * The default witness: System.Number at the finalized head. The stored value is
 * a plain little-endian u32, so the decoded number must equal the block number
 * of the very block the proof was taken at.
 */
export async function readNativeWitness(
  key = SYSTEM_NUMBER_KEY,
  label = 'System.Number',
): Promise<NativeWitness> {
  const proof = await readStorageProof(key)

  const decodedNumber =
    proof.decoded?.reading === 'u32' ? Number(proof.decoded.value) : null

  return {
    ...proof,
    keyLabel: label,
    expectedNumber: proof.blockNumber,
    valueIsHead: decodedNumber === proof.blockNumber,
  }
}

export type EvmWitnessProbe =
  | {
      supported: true
      address: string
      blockNumber: number | null
      stateRoot: string | null
      balance: string
      nonce: number
      codeHash: string
      storageHash: string
      nodes: number
      bytes: number
      latencyMs: number
    }
  | {
      supported: false
      reason: string
      method: string
      /** the address asked, or null when the endpoint never named a producer */
      address: string | null
      blockNumber: number | null
      stateRoot: string | null
      latencyMs: number
    }

/**
 * Ask the Revive endpoint for an account witness at the finalized block, for
 * the account that produced that block. This test endpoint answers Method not
 * found, and the console reports that refusal rather than assuming, or drawing
 * a witness of its own.
 *
 * The address is the block's own miner field. When the endpoint returns no
 * finalized block there is no account to ask about, so the probe says so
 * instead of substituting a zero address.
 */
export async function probeEvmWitness(): Promise<EvmWitnessProbe> {
  const started = Date.now()

  const block = await rpc<{
    number: string
    miner: string
    stateRoot: string
  } | null>(EVM_RPC, 'eth_getBlockByNumber', ['finalized', false])

  if (block === null) {
    return {
      supported: false,
      reason: 'the endpoint returned no finalized block, so there is no account to ask about',
      method: 'eth_getBlockByNumber',
      address: null,
      blockNumber: null,
      stateRoot: null,
      latencyMs: Date.now() - started,
    }
  }

  const address = block.miner
  const blockNumber = Number(BigInt(block.number))

  try {
    const proof = await rpc<{
      balance: string
      nonce: string
      codeHash: string
      storageHash: string
      accountProof: string[]
    }>(EVM_RPC, 'eth_getProof', [address, [], 'finalized'])

    return {
      supported: true,
      address,
      blockNumber,
      stateRoot: block?.stateRoot ?? null,
      balance: BigInt(proof.balance).toString(),
      nonce: Number(BigInt(proof.nonce)),
      codeHash: proof.codeHash,
      storageHash: proof.storageHash,
      nodes: proof.accountProof.length,
      bytes: proof.accountProof.reduce(
        (total, node) => total + Math.max(0, (node.length - 2) / 2),
        0,
      ),
      latencyMs: Date.now() - started,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'the call was refused'
    const split = message.indexOf(': ')
    return {
      supported: false,
      reason: split === -1 ? message : message.slice(split + 2),
      method: split === -1 ? 'eth_getProof' : message.slice(0, split),
      address,
      blockNumber,
      stateRoot: block?.stateRoot ?? null,
      latencyMs: Date.now() - started,
    }
  }
}

export type NativeModuleProbe = {
  /** the runtime API that would exist if the pallet were loaded */
  method: string
  /** a runtime API this node is known to expose, used as a control */
  control: string
  controlAnswered: boolean
  /** true = api answered, false = api absent, null = inconclusive */
  present: boolean | null
  message: string | null
  latencyMs: number
}

function isMissingMethod(message: string) {
  return /(exported method .* is not found|method not found|not exported|not implemented|unknown method)/i.test(
    message,
  )
}

/**
 * Asks the runtime itself whether it exports a runtime API. This is how the
 * console answers "is the native contracts module launched" without asserting
 * it: a runtime with no contracts pallet does not export ContractsApi, and
 * state_call says exactly that. The control call proves state_call works on
 * this node at all, so an absence is an absence and not a dead endpoint.
 */
export async function probeNativeModule(
  method = 'ContractsApi_contract_info',
  control = 'Metadata_metadata_versions',
): Promise<NativeModuleProbe> {
  const started = Date.now()

  let controlAnswered = false

  try {
    const answer = await rpc<string>(NATIVE_RPC, 'state_call', [control, '0x'])
    controlAnswered = typeof answer === 'string' && answer.length > 2
  } catch {
    // Not fatal: an inconclusive target call reports present as null below.
  }

  try {
    await rpc<string>(NATIVE_RPC, 'state_call', [method, '0x'])

    return {
      method,
      control,
      controlAnswered,
      present: true,
      message: null,
      latencyMs: Date.now() - started,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'the node did not answer'
    const split = message.indexOf(': ')
    const detail = split === -1 ? message : message.slice(split + 2)

    return {
      method,
      control,
      controlAnswered,
      present: isMissingMethod(detail) ? false : null,
      message: detail,
      latencyMs: Date.now() - started,
    }
  }
}

export type LatencyReading = {
  runtime: 'wasm' | 'revive'
  endpoint: string
  method: string
  samples: number[]
  medianMs: number | null
  error: string | null
}

/** Three sequential round trips per endpoint. Serialized on purpose. */
export async function measureLatency(samples = 3): Promise<LatencyReading[]> {
  const read = async (
    runtime: LatencyReading['runtime'],
    endpoint: string,
    method: string,
  ): Promise<LatencyReading> => {
    const timings: number[] = []

    try {
      for (let index = 0; index < samples; index += 1) {
        const started = Date.now()
        await rpc<unknown>(endpoint, method)
        timings.push(Date.now() - started)
      }

      return {
        runtime,
        endpoint,
        method,
        samples: timings,
        medianMs: median(timings),
        error: null,
      }
    } catch (error) {
      return {
        runtime,
        endpoint,
        method,
        samples: timings,
        medianMs: median(timings),
        error: error instanceof Error ? error.message : 'the endpoint did not answer',
      }
    }
  }

  return [
    await read('wasm', NATIVE_RPC, 'system_chain'),
    await read('revive', EVM_RPC, 'eth_chainId'),
  ]
}
