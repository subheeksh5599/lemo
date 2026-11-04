import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UPSTREAM = {
  native: process.env.NEXT_PUBLIC_NATIVE_RPC ?? 'https://test-node-v3.portaldot.dev',
  evm: process.env.NEXT_PUBLIC_EVM_RPC ?? 'https://test-evm-rpc-v3.portaldot.dev',
} as const

const ALLOWED = new Set([
  'system_chain',
  'beefy_getFinalizedHead',
  'chain_getBlock',
  'chain_getBlockHash',
  'chain_getFinalizedHead',
  'chain_getHeader',
  'state_call',
  'state_getReadProof',
  'state_getStorage',
  'eth_chainId',
  'eth_blockNumber',
  'eth_call',
  'eth_getBalance',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getProof',
  'eth_getTransactionReceipt',
])

type Cached = { at: number; status: number; body: string }
const cache = new Map<string, Cached>()
const CACHE_MS = 2_500

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function POST(
  request: Request,
  context: { params: Promise<{ chain: string }> },
) {
  const { chain } = await context.params
  if (chain !== 'native' && chain !== 'evm') {
    return NextResponse.json({ error: 'unknown chain' }, { status: 404 })
  }

  const body = await request.text()
  if (body.length > 200_000) {
    return NextResponse.json({ error: 'request too large' }, { status: 413 })
  }

  let payload: { method?: unknown }
  try {
    payload = JSON.parse(body) as { method?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  if (typeof payload.method !== 'string' || !ALLOWED.has(payload.method)) {
    return NextResponse.json({ error: 'method not allowed' }, { status: 403 })
  }

  const key = `${chain}:${body}`
  const hit = cache.get(key)
  if (hit !== undefined && Date.now() - hit.at < CACHE_MS) {
    return new Response(hit.body, {
      status: hit.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  }

  let lastStatus = 502
  let lastBody = JSON.stringify({ error: 'upstream unavailable' })

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(UPSTREAM[chain], {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        cache: 'no-store',
        signal: AbortSignal.timeout(12_000),
      })

      lastStatus = response.status
      lastBody = await response.text()

      if (response.ok) {
        cache.set(key, { at: Date.now(), status: 200, body: lastBody })
        return new Response(lastBody, {
          status: 200,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        })
      }

      if (response.status !== 429 && response.status !== 503) break
    } catch {
      lastStatus = 502
      lastBody = JSON.stringify({ error: 'upstream connection failed' })
    }

    if (attempt < 4) await delay(250 * attempt)
  }

  return new Response(lastBody, {
    status: lastStatus,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
