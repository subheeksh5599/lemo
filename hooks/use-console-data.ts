'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  readNativeBlocks,
  readEvmHead,
  readNativeHead,
  type EvmHead,
  type NativeBlock,
  type NativeHead,
} from '@/lib/chain'

export type ConsoleStatus = 'reading' | 'live' | 'stale' | 'down'

export type ConsoleSnapshot = {
  native: NativeHead | null
  evm: EvmHead | null
  blocks: NativeBlock[]
  blocksError: string | null
  error: string | null
  updatedAt: number | null
  blocksAt: number | null
}

const HEAD_POLL_MS = 15_000
const BLOCK_POLL_MS = 60_000
/** A reading older than this is not live any more, whatever the last call said. */
const LIVE_WINDOW_MS = 3 * HEAD_POLL_MS

export function useConsoleData(blockCount = 12) {
  const [snapshot, setSnapshot] = useState<ConsoleSnapshot>({
    native: null,
    evm: null,
    blocks: [],
    blocksError: null,
    error: null,
    updatedAt: null,
    blocksAt: null,
  })
  const [reading, setReading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const mounted = useRef(true)
  const busy = useRef(false)
  const windowSize = useRef(blockCount)

  const readHeads = useCallback(async () => {
    try {
      const [native, evm] = await Promise.all([readNativeHead(), readEvmHead()])
      if (!mounted.current) return
      setSnapshot((current) => ({
        ...current,
        native,
        evm,
        error: null,
        updatedAt: Date.now(),
      }))
    } catch (cause) {
      if (!mounted.current) return
      setSnapshot((current) => ({
        ...current,
        error: cause instanceof Error ? cause.message : 'the node did not answer',
        updatedAt: Date.now(),
      }))
    }
  }, [])

  const readBlocks = useCallback(async () => {
    try {
      // Blocks arrive one call at a time and render as they land. The first
      // paint asks for a short window; it grows once the node has kept up.
      const count = windowSize.current
      const blocks = await readNativeBlocks(count, (partial) => {
        if (!mounted.current || partial.length === 0) return
        setSnapshot((current) => ({ ...current, blocks: partial, blocksAt: Date.now() }))
      })
      if (!mounted.current) return
      if (blocks.length >= Math.min(count, 8)) windowSize.current = 20
      setSnapshot((current) => ({ ...current, blocks, blocksError: null, blocksAt: Date.now() }))
    } catch (cause) {
      if (!mounted.current) return
      setSnapshot((current) => ({
        ...current,
        blocksError: cause instanceof Error ? cause.message : 'the node did not answer',
      }))
    }
  }, [])

  const refresh = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setRefreshing(true)
    await Promise.all([readHeads(), readBlocks()])
    busy.current = false
    if (mounted.current) {
      setReading(false)
      setRefreshing(false)
    }
  }, [readHeads, readBlocks])

  useEffect(() => {
    mounted.current = true
    void refresh()

    const headTimer = window.setInterval(() => void readHeads(), HEAD_POLL_MS)
    const blockTimer = window.setInterval(() => void readBlocks(), BLOCK_POLL_MS)

    return () => {
      mounted.current = false
      window.clearInterval(headTimer)
      window.clearInterval(blockTimer)
    }
  }, [readHeads, readBlocks, refresh])

  const now = useNow(2_000)

  const status: ConsoleStatus =
    snapshot.updatedAt === null
      ? 'reading'
      : snapshot.error !== null
        ? snapshot.native === null
          ? 'down'
          : 'stale'
        : now - snapshot.updatedAt > LIVE_WINDOW_MS
          ? 'stale'
          : 'live'

  return { ...snapshot, reading, refreshing, status, refresh }
}

/** Re-renders on a timer so a relative time stays honest without re-fetching. */
export function useNow(intervalMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])

  return now
}
