import { NextResponse } from 'next/server'

import { connect } from '@/scripts/capture-beefy.mjs'
import { plan } from '@/scripts/relay-beefy.mjs'

/**
 * The calls that bring BeefyRootFeed up to the newest BEEFY-justified block,
 * in order: one per validator set the feed missed, then the newest root. This
 * is the same planner the scheduled relayer runs. The calldata is not trusted
 * by anyone: the feed checks every byte against the validators' signatures.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const EVM_RPC = process.env.NEXT_PUBLIC_EVM_RPC?.startsWith('http')
  ? process.env.NEXT_PUBLIC_EVM_RPC
  : 'https://test-evm-rpc-v3.portaldot.dev'
const FEED = (process.env.NEXT_PUBLIC_LEMO_BEEFY_FEED ?? '').trim()

async function feedWord(selector: string): Promise<number> {
  const response = await fetch(EVM_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: FEED, data: selector }, 'latest'] }),
    cache: 'no-store',
  })
  const body = (await response.json()) as { result?: string; error?: { message?: string } }
  if (body.result === undefined) throw new Error(body.error?.message ?? 'eth_call failed')
  return Number(BigInt(body.result))
}

type Step = { kind: string; note: string; block: number; stateRoot: string; data: string }

export async function GET() {
  if (!/^0x[0-9a-fA-F]{40}$/.test(FEED)) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_LEMO_BEEFY_FEED is not set' }, { status: 503 })
  }
  // validatorSetId() and currentBlockNumber()
  const [setId, block] = await Promise.all([feedWord('0x50974e31'), feedWord('0x378ec23b')])
  const api = await connect()
  try {
    const steps = (await plan(api, { setId, block })) as Step[] & { finalSetId: number }
    return NextResponse.json({
      feed: { setId, block },
      finalSetId: steps.finalSetId,
      steps: steps.map(({ note, block: rootBlock, stateRoot, data }) => ({ note, block: rootBlock, stateRoot, data })),
    })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 })
  } finally {
    await api.disconnect()
  }
}
