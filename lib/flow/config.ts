/**
 * Where the flow console looks for the deployed contracts.
 *
 * Nothing here is an address. Each slot reads one `NEXT_PUBLIC_*` variable at
 * build time and reports three states: set and well formed, set but malformed,
 * or absent. An absent slot is a real state the page renders ("not deployed
 * yet") rather than a placeholder address that would only fail later, inside a
 * wallet prompt.
 */

export type ContractKey = 'gate' | 'verifier' | 'feed'

export type ContractSlot = {
  key: ContractKey
  label: string
  /** The variable the address must come from. Named verbatim in the UI. */
  env: string
  detail: string
  /** Lowercased 20 byte address, or null when the variable is absent or bad. */
  address: string | null
  /** Why `address` is null. Null when the slot is usable. */
  problem: string | null
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

function readAddress(env: string, raw: string | undefined | null): {
  address: string | null
  problem: string | null
} {
  const value = (raw ?? '').trim()

  if (value.length === 0) {
    return { address: null, problem: `${env} is not set` }
  }

  if (!ADDRESS_PATTERN.test(value)) {
    return {
      address: null,
      problem: `${env} is not a 20 byte hex address (got ${value.slice(0, 12)}${
        value.length > 12 ? '…' : ''
      })`,
    }
  }

  return { address: value.toLowerCase(), problem: null }
}

const gate = readAddress('NEXT_PUBLIC_LEMO_GATE', process.env.NEXT_PUBLIC_LEMO_GATE)
const verifier = readAddress(
  'NEXT_PUBLIC_LEMO_VERIFIER',
  process.env.NEXT_PUBLIC_LEMO_VERIFIER,
)
const feed = readAddress('NEXT_PUBLIC_LEMO_FEED', process.env.NEXT_PUBLIC_LEMO_FEED)

/** The three contracts the flow talks to, in the order the page lists them. */
export const CONTRACTS: readonly ContractSlot[] = [
  {
    key: 'gate',
    label: 'Title gate',
    env: 'NEXT_PUBLIC_LEMO_GATE',
    detail: 'The gated ERC-20. Mint and transfer revert without a proven title.',
    ...gate,
  },
  {
    key: 'verifier',
    label: 'Trie verifier',
    env: 'NEXT_PUBLIC_LEMO_VERIFIER',
    detail: 'Walks sp-trie nodes from a state root and decodes the title record.',
    ...verifier,
  },
  {
    key: 'feed',
    label: 'Root feed',
    env: 'NEXT_PUBLIC_LEMO_FEED',
    detail: 'The root the gate accepts. Single attester or M-of-N.',
    ...feed,
  },
]

export function contract(key: ContractKey): ContractSlot {
  const slot = CONTRACTS.find((item) => item.key === key)
  if (slot === undefined) throw new Error(`unknown contract slot ${key}`)
  return slot
}

/** Every slot that cannot be used yet, with its reason. */
export function missingContracts(): ContractSlot[] {
  return CONTRACTS.filter((slot) => slot.address === null)
}

/**
 * The explorer, when one is configured for this chain. The base comes from the
 * environment because a chain id does not encode a hostname; the link built
 * from it carries the live transaction hash and the chain id the wallet is on,
 * never a hardcoded address or network.
 */
export const EXPLORER_ENV = 'NEXT_PUBLIC_EVM_EXPLORER'

export const EXPLORER_BASE: string | null = (() => {
  const raw = (process.env.NEXT_PUBLIC_EVM_EXPLORER ?? '').trim()
  if (raw.length === 0) return null
  if (!/^https?:\/\//.test(raw)) return null
  return raw.replace(/\/+$/, '')
})()

export function explorerTxUrl(hash: string): string | null {
  if (EXPLORER_BASE === null) return null
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return null
  return `${EXPLORER_BASE}/tx/${hash}`
}
