#!/usr/bin/env node
/**
 * LEMO RPC reachability check.
 *
 * Answers one question with evidence: can this machine talk to both Portaldot
 * V3 testnet runtimes right now, and is the EVM endpoint the chain we think it
 * is? Reads only. No fixtures, no fallbacks that hide a failure.
 *
 * Defaults are the public testnet endpoints. Override with:
 *   LEMO_NATIVE_RPC / NEXT_PUBLIC_NATIVE_RPC
 *   LEMO_EVM_RPC    / NEXT_PUBLIC_EVM_RPC
 *   LEMO_CHAIN_ID   (default 420420777)
 *
 * Exit: 0 every check passed, 1 any check failed.
 * Usable standalone (`node scripts/check-rpc.mjs`) or imported by verify.mjs.
 */

import { pathToFileURL } from 'node:url'

const EXPECTED_CHAIN_ID = Number(process.env.LEMO_CHAIN_ID ?? 420420777)

export const NATIVE_RPC =
  process.env.LEMO_NATIVE_RPC ??
  process.env.NEXT_PUBLIC_NATIVE_RPC ??
  'https://test-node-v3.portaldot.dev'

export const EVM_RPC =
  process.env.LEMO_EVM_RPC ??
  process.env.NEXT_PUBLIC_EVM_RPC ??
  'https://test-evm-rpc-v3.portaldot.dev'

const REQUEST_TIMEOUT_MS = Number(process.env.LEMO_RPC_TIMEOUT_MS ?? 15000)
const ATTEMPTS = 3

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function describe(error) {
  if (error && error.name === 'TimeoutError') {
    return `timeout after ${REQUEST_TIMEOUT_MS}ms (no answer from the endpoint)`
  }
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * One JSON-RPC call. Retries on transport faults, timeouts, 429 and 503.
 * A node-level error reply (method not found, bad params) is NOT retried: the
 * node answered, and its answer is the result.
 */
export async function rpc(
  url,
  method,
  params = [],
  { timeoutMs = REQUEST_TIMEOUT_MS, attempts = ATTEMPTS } = {},
) {
  let last = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      })

      const text = await response.text()

      if (!response.ok) {
        const retriable = response.status === 429 || response.status === 503
        const error = new Error(
          `HTTP ${response.status} ${text.slice(0, 120).replace(/\s+/g, ' ')}`,
        )
        error.httpStatus = response.status
        error.retriable = retriable
        throw error
      }

      let payload
      try {
        payload = JSON.parse(text)
      } catch {
        throw new Error(`non-JSON response: ${text.slice(0, 120)}`)
      }

      if (payload.error) {
        const error = new Error(
          `${method}: ${payload.error.message ?? 'the node rejected the call'}` +
            (payload.error.code === undefined ? '' : ` (code ${payload.error.code})`),
        )
        error.rpcError = payload.error
        throw error
      }

      if (!('result' in payload)) {
        throw new Error(`${method}: response carried no result`)
      }

      return payload.result
    } catch (error) {
      last = error
      if (error && error.rpcError) throw error
      const retriable =
        (error && error.name === 'TimeoutError') ||
        (error && error.retriable === true) ||
        /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(
          error instanceof Error ? error.message : '',
        )
      if (attempt < attempts && retriable) {
        await sleep(500 * attempt)
        continue
      }
      throw error
    }
  }

  throw last
}

const isHash = (value) => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value)
const blockNumber = (hex) => Number(BigInt(hex))

/**
 * Runs every RPC check and returns rows: { id, status, detail }.
 * status is PASS or FAIL for assertions, INFO for observed facts.
 */
export async function runRpcChecks({ timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const rows = []
  const push = (id, status, detail) => rows.push({ group: 'rpc', id, status, detail })

  // 1. Reachability of the native runtime, then its chain identity.
  let chain = null
  let finalizedHash = null
  let nativeHeader = null

  try {
    chain = await rpc(NATIVE_RPC, 'system_chain', [], { timeoutMs })
    push(
      'native system_chain',
      typeof chain === 'string' && chain.length > 0 ? 'PASS' : 'FAIL',
      typeof chain === 'string' && chain.length > 0 ? chain : `unexpected result: ${JSON.stringify(chain)}`,
    )
  } catch (error) {
    push('native system_chain', 'FAIL', `${describe(error)} [${NATIVE_RPC}]`)
  }

  try {
    finalizedHash = await rpc(NATIVE_RPC, 'chain_getFinalizedHead', [], { timeoutMs })
    push(
      'native finalized head hash',
      isHash(finalizedHash) ? 'PASS' : 'FAIL',
      isHash(finalizedHash) ? finalizedHash : `unexpected result: ${JSON.stringify(finalizedHash)}`,
    )
  } catch (error) {
    push('native finalized head hash', 'FAIL', `${describe(error)} [${NATIVE_RPC}]`)
  }

  if (isHash(finalizedHash)) {
    try {
      nativeHeader = await rpc(NATIVE_RPC, 'chain_getHeader', [finalizedHash], { timeoutMs })
      const number =
        nativeHeader && typeof nativeHeader.number === 'string'
          ? blockNumber(nativeHeader.number)
          : null
      const rootOk = nativeHeader && isHash(nativeHeader.stateRoot)
      push(
        'native finalized header',
        number !== null && rootOk ? 'PASS' : 'FAIL',
        number !== null && rootOk
          ? `#${number} stateRoot ${nativeHeader.stateRoot}`
          : `unexpected result: ${JSON.stringify(nativeHeader).slice(0, 160)}`,
      )
    } catch (error) {
      push('native finalized header', 'FAIL', `${describe(error)} [${NATIVE_RPC}]`)
    }
  } else {
    push('native finalized header', 'FAIL', 'skipped: no finalized head hash to read')
  }

  // 2. EVM chain id. This is the chain assertion that matters: a wrong chain
  //    id means every later console reading is from a different network.
  let chainId = null
  try {
    const raw = await rpc(EVM_RPC, 'eth_chainId', [], { timeoutMs })
    chainId = Number(BigInt(raw))
    push(
      'evm eth_chainId',
      chainId === EXPECTED_CHAIN_ID ? 'PASS' : 'FAIL',
      chainId === EXPECTED_CHAIN_ID
        ? `${raw} = ${chainId} (expected ${EXPECTED_CHAIN_ID})`
        : `${raw} = ${chainId}, expected ${EXPECTED_CHAIN_ID} [${EVM_RPC}]`,
    )
  } catch (error) {
    push('evm eth_chainId', 'FAIL', `${describe(error)} [${EVM_RPC}]`)
  }

  try {
    const raw = await rpc(EVM_RPC, 'eth_blockNumber', [], { timeoutMs })
    const head = blockNumber(raw)
    push('evm eth_blockNumber', Number.isInteger(head) && head > 0 ? 'PASS' : 'FAIL', `#${head}`)
  } catch (error) {
    push('evm eth_blockNumber', 'FAIL', `${describe(error)} [${EVM_RPC}]`)
  }

  try {
    const block = await rpc(EVM_RPC, 'eth_getBlockByNumber', ['finalized', false], { timeoutMs })
    const ok = block !== null && isHash(block.stateRoot) && typeof block.number === 'string'
    push(
      'evm finalized block',
      ok ? 'PASS' : 'FAIL',
      ok ? `#${blockNumber(block.number)} stateRoot ${block.stateRoot}` : `unexpected result: ${JSON.stringify(block).slice(0, 160)}`,
    )
  } catch (error) {
    push('evm finalized block', 'FAIL', `${describe(error)} [${EVM_RPC}]`)
  }

  // 3. The known node limitation. This is observed, not assumed: if the node
  //    ever starts supporting eth_getProof the console's copy must change, so
  //    the check reports what the node actually said either way.
  try {
    const proof = await rpc(
      EVM_RPC,
      'eth_getProof',
      ['0x0000000000000000000000000000000000000000', [], 'finalized'],
      { timeoutMs },
    )
    push(
      'evm eth_getProof availability',
      'INFO',
      `node now ANSWERS eth_getProof (${Array.isArray(proof?.accountProof) ? proof.accountProof.length : 0} proof nodes). The console's "method not supported" copy must be updated.`,
    )
  } catch (error) {
    const refused = Boolean(error && error.rpcError) || /method not found|not supported|not implemented/i.test(describe(error))
    push(
      'evm eth_getProof availability',
      'INFO',
      refused
        ? `node refuses eth_getProof: ${describe(error)}`
        : `probe failed without a node refusal: ${describe(error)}`,
    )
  }

  return rows
}

function table(rows) {
  const width = rows.reduce((max, row) => Math.max(max, row.id.length), 0)
  return rows
    .map((row) => `  ${row.id.padEnd(width)}  ${row.status.padEnd(5)}  ${row.detail}`)
    .join('\n')
}

async function main() {
  const started = Date.now()
  console.log('LEMO RPC check')
  console.log(`  native ${NATIVE_RPC}`)
  console.log(`  evm    ${EVM_RPC}`)
  console.log(`  expect chain id ${EXPECTED_CHAIN_ID}, timeout ${REQUEST_TIMEOUT_MS}ms\n`)

  const rows = await runRpcChecks()
  console.log(table(rows))

  const failures = rows.filter((row) => row.status === 'FAIL')
  console.log(
    `\n${rows.length} checks in ${Date.now() - started}ms: ` +
      `${rows.filter((row) => row.status === 'PASS').length} pass, ${failures.length} fail, ` +
      `${rows.filter((row) => row.status === 'INFO').length} observed`,
  )

  if (failures.length > 0) {
    console.log('\nFAILED')
    for (const row of failures) console.log(`  - ${row.id}: ${row.detail}`)
    return 1
  }

  console.log('\nPASS')
  return 0
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      console.error('check-rpc crashed:', error)
      process.exitCode = 1
    })
}
