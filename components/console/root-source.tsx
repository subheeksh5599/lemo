'use client'

import { useEffect, useState } from 'react'

import { contract } from '@/lib/flow/config'
import { readFeedState, type FeedState, type Probe } from '@/lib/flow/state'

/**
 * Where the EVM gate gets the finalized native state root it checks proofs
 * against. This is the one place the feed type is named, so a new feed kind
 * (for example a validator-signed BEEFY feed) is a new case here and nothing
 * else in the console changes.
 */
export type RootSourceKind = 'single-attester' | 'no-single-attester'

export function rootSourceKind(feed: FeedState): RootSourceKind {
  return feed.attester === null ? 'no-single-attester' : 'single-attester'
}

export const ROOT_SOURCE_LABEL: Record<RootSourceKind, string> = {
  'single-attester': 'trusted single attester',
  'no-single-attester': 'threshold feed, no single attester',
}

export type RootSourceReading =
  | { kind: 'unset'; env: string }
  | { kind: 'reading' }
  | { kind: 'failed'; message: string }
  | { kind: 'read'; label: string; feed: FeedState; address: string }

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
  return {
    kind: 'read',
    label: ROOT_SOURCE_LABEL[rootSourceKind(probe.state)],
    feed: probe.state,
    address: probe.address,
  }
}
