'use client'

import { useEffect, useState } from 'react'

import { isBeefyFeed } from '@/lib/beefy'
import { contract } from '@/lib/flow/config'
import { readFeedState, type FeedState, type Probe } from '@/lib/flow/state'

/**
 * Where the EVM gate gets the finalized native state root it checks proofs
 * against. This is the one place the feed type is named, so a new feed kind
 * (for example a validator-signed BEEFY feed) is a new case here and nothing
 * else in the console changes.
 */
export type RootSourceKind = 'single-attester' | 'no-single-attester' | 'validator-signed'

/**
 * `address` is the feed the gate points at. When it is the configured
 * BeefyRootFeed (NEXT_PUBLIC_LEMO_BEEFY_FEED), roots land only on BEEFY
 * validator signatures; see /console/finality.
 */
export function rootSourceKind(feed: FeedState, address?: string | null): RootSourceKind {
  if (isBeefyFeed(address)) return 'validator-signed'
  return feed.attester === null ? 'no-single-attester' : 'single-attester'
}

export const ROOT_SOURCE_LABEL: Record<RootSourceKind, string> = {
  'single-attester': 'trusted single attester',
  'no-single-attester': 'threshold feed, no single attester',
  'validator-signed': 'validator-signed (BEEFY)',
}

/** The tone a root source reads in: a single attester is a warning, BEEFY is ok. */
export const ROOT_SOURCE_TONE: Record<RootSourceKind, 'ok' | 'warn' | 'default'> = {
  'single-attester': 'warn',
  'no-single-attester': 'default',
  'validator-signed': 'ok',
}

export type RootSourceReading =
  | { kind: 'unset'; env: string }
  | { kind: 'reading' }
  | { kind: 'failed'; message: string }
  | { kind: 'read'; label: string; source: RootSourceKind; feed: FeedState; address: string }

/** Reads the configured root feed once, through the same RPC path as the flow page. */
export function useRootSource(): RootSourceReading {
  const slot = contract('feed')
  const [probe, setProbe] = useState<Probe<FeedState> | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (slot.address === null) return
    let alive = true
    readFeedState(slot.address)
      .then((value) => {
        if (alive) setProbe(value)
      })
      .catch((cause: unknown) => {
        if (alive) setFailure(cause instanceof Error ? cause.message : 'the feed did not answer')
      })
    return () => {
      alive = false
    }
  }, [slot.address])

  if (slot.address === null) return { kind: 'unset', env: slot.env }
  if (failure !== null) return { kind: 'failed', message: failure }
  if (probe === null) return { kind: 'reading' }
  if (probe.state === null) return { kind: 'failed', message: probe.problem ?? 'no feed state' }
  const source = rootSourceKind(probe.state, probe.address)
  return {
    kind: 'read',
    label: ROOT_SOURCE_LABEL[source],
    source,
    feed: probe.state,
    address: probe.address,
  }
}
