/**
 * The earlier two-contract deployment.
 *
 * These addresses are constants because they are the subject of the page, not
 * readings. Everything about them, including the receipts, is read from the
 * chain at request time. Nothing falls back to a fixture when a read fails.
 *
 * This is not the four-contract gate. The registry is an EVM contract and the
 * token checks that registry before a transfer; no native storage proof is
 * involved. The page says that in the copy.
 */

import { EVM_RPC, rpc } from '@/lib/chain'

export const LEGACY_TITLE = '0xc88763fa361669fc5d95c2bdd924b0e2872488bb'
export const LEGACY_TOKEN = '0x61c35d5e811b99f2641b43e9ef97e50d52de8ff7'
export const LEGACY_TITLE_ID =
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export type HistoricalTx = {
  label: string
  hash: string
  note: string
}

/** Settled transactions read back from the chain, not links to a fixture. */
export const HISTORICAL_TXS: readonly HistoricalTx[] = [
  {
    label: 'Mint 1,000',
    hash: '0xe7391b28393c1273b0d9e5316725408c57e189b2ee34447fe77c8cb1ace8b525',
    note: 'The issuer minted to the cap.',
  },
  {
    label: 'Transfer 10',
    hash: '0x82cf8b4ea676eb30b29e31ab9019c571fd650c2d27e2c10e88cba7bf9478c11f',
    note: 'Moved while the title was eligible.',
  },
  {
    label: 'Freeze title',
    hash: '0xc038a6d31cd1076a0dfe60b0267b28b4bc85458af15ee8582a3cf2bb4a599a2f',
    note: 'The governor set eligible to false.',
  },
  {
    label: 'Unfreeze title',
    hash: '0xd8958bbf3de0dfc42cab20b8d1a013da4cd1a44c550b107e58f7e791c9e4f068',
    note: 'The governor set eligible back to true.',
  },
  {
    label: 'Transfer 5',
    hash: '0xfab5374ab496e3211379d0cce42475b681748f105652c03fe7d8268aad7f95b8',
    note: 'Moved after the title was eligible again.',
  },
]

export type LegacyTitle = {
  asset: string
  backing: bigint
  revision: number
  digest: string
  eligible: boolean
}

export type LegacyToken = {
  supply: bigint
  cap: bigint
  decimals: number
  issuer: string
  registry: string
  issuerBalance: bigint
}

export type Receipt = {
  label: string
  hash: string
  note: string
  status: 'success' | 'reverted' | 'missing'
  block: number | null
  problem: string | null
}

export type LegacySnapshot = {
  title: LegacyTitle
  token: LegacyToken
  receipts: Receipt[]
  readAt: number
  latencyMs: number
}

const SELECTORS = {
  titles: '0xf6ef0d3d',
  totalSupply: '0x18160ddd',
  cap: '0x355274ea',
  decimals: '0x313ce567',
  issuer: '0x1d143848',
  registry: '0x7b103999',
  balanceOf: '0x70a08231',
} as const

/**
 * The selectors this page actually uses. They are constants beside the
 * addresses, not pulled from a client library, so the page has no hidden
 * encoding layer. `cast sig` produced each value from the source signature.
 */

function body(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
}

function word(hex: string, index: number): string {
  return body(hex)
    .slice(index * 64, index * 64 + 64)
    .padEnd(64, '0')
}

function addressOf(hex: string, index = 0): string {
  return `0x${word(hex, index).slice(24).toLowerCase()}`
}

function bigOf(hex: string, index = 0): bigint {
  return BigInt(`0x${word(hex, index) || '0'}`)
}

function bytes32Of(hex: string, index = 0): string {
  return `0x${word(hex, index).toLowerCase()}`
}

function encodeAddress(value: string): string {
  return value.toLowerCase().replace(/^0x/, '').padStart(64, '0')
}

async function call(to: string, data: string): Promise<string> {
  return rpc<string>(EVM_RPC, 'eth_call', [{ to, data }, 'latest'])
}

async function receipt(tx: HistoricalTx): Promise<Receipt> {
  try {
    const result = await rpc<{
      status?: string
      blockNumber?: string
    } | null>(EVM_RPC, 'eth_getTransactionReceipt', [tx.hash])

    if (result === null) {
      return { ...tx, status: 'missing', block: null, problem: 'no receipt returned' }
    }

    const block =
      result.blockNumber === undefined ? null : Number(BigInt(result.blockNumber))
    const status = result.status === '0x1' ? 'success' : 'reverted'

    return { ...tx, status, block, problem: null }
  } catch (error) {
    return {
      ...tx,
      status: 'missing',
      block: null,
      problem: error instanceof Error ? error.message : 'receipt read failed',
    }
  }
}

export async function readLegacy(): Promise<LegacySnapshot> {
  const started = Date.now()

  const [titleRaw, supplyRaw, capRaw, decimalsRaw, issuerRaw, registryRaw] =
    await Promise.all([
      call(LEGACY_TITLE, `${SELECTORS.titles}${LEGACY_TITLE_ID.slice(2)}`),
      call(LEGACY_TOKEN, SELECTORS.totalSupply),
      call(LEGACY_TOKEN, SELECTORS.cap),
      call(LEGACY_TOKEN, SELECTORS.decimals),
      call(LEGACY_TOKEN, SELECTORS.issuer),
      call(LEGACY_TOKEN, SELECTORS.registry),
    ])

  if (body(titleRaw).length < 5 * 64) {
    throw new Error('the registry returned no title record')
  }

  const issuer = addressOf(issuerRaw)
  const balanceRaw = await call(
    LEGACY_TOKEN,
    `${SELECTORS.balanceOf}${encodeAddress(issuer)}`,
  )

  const title: LegacyTitle = {
    asset: bytes32Of(titleRaw, 0),
    backing: bigOf(titleRaw, 1),
    revision: Number(bigOf(titleRaw, 2)),
    digest: bytes32Of(titleRaw, 3),
    eligible: bigOf(titleRaw, 4) !== 0n,
  }

  const token: LegacyToken = {
    supply: bigOf(supplyRaw),
    cap: bigOf(capRaw),
    decimals: Number(bigOf(decimalsRaw)),
    issuer,
    registry: addressOf(registryRaw),
    issuerBalance: bigOf(balanceRaw),
  }

  const receipts = await Promise.all(HISTORICAL_TXS.map((tx) => receipt(tx)))

  return {
    title,
    token,
    receipts,
    readAt: Date.now(),
    latencyMs: Date.now() - started,
  }
}
