import { EVM_RPC, NATIVE_RPC } from '@/lib/chain'

import { CONTRACTS, contract } from './config'
import { readChain } from './evm'
import {
  readFeedState,
  readGateState,
  readVerifierState,
  type FeedState,
  type GateState,
  type Probe,
  type VerifierState,
} from './state'

export type FlowSnapshot = {
  readAt: number
  latencyMs: number
  chain: { chainId: number; head: number }
  gate: Probe<GateState> | null
  verifier: Probe<VerifierState> | null
  feed: Probe<FeedState> | null
}

/**
 * One pass over everything the page shows: the chain the endpoint reports and
 * the three contracts, each read only when its variable is set. Addresses are
 * never substituted, so an unset slot stays unset here and the page renders it
 * as an unset slot.
 */
export async function readFlowSnapshot(): Promise<FlowSnapshot> {
  const started = Date.now()

  const gateSlot = contract('gate')
  const verifierSlot = contract('verifier')
  const feedSlot = contract('feed')

  const [chain, gateProbe, verifierProbe, feedProbe] = await Promise.all([
    readChain(),
    gateSlot.address === null ? null : readGateState(gateSlot.address),
    verifierSlot.address === null ? null : readVerifierState(verifierSlot.address),
    feedSlot.address === null ? null : readFeedState(feedSlot.address),
  ])

  return {
    chain,
    gate: gateProbe,
    verifier: verifierProbe,
    feed: feedProbe,
    readAt: Date.now(),
    latencyMs: Date.now() - started,
  }
}

/** Which variables are unset, for the "not deployed yet" panel. */
export const UNSET_CONTRACTS = CONTRACTS.filter((slot) => slot.address === null)

export const ENDPOINTS = { evm: EVM_RPC, native: NATIVE_RPC } as const
