'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  type EvmWitnessProbe,
  type NativeModuleProbe,
  type NativeWitness,
  type StorageProof,
  probeEvmWitness,
  probeNativeModule,
  readNativeWitness,
  readStorageProof,
} from '@/lib/chain'

type Reading<T> = {
  data: T | null
  error: string | null
  reading: boolean
  readAt: number | null
  read: () => Promise<void>
}

/**
 * One live witness for a storage key, re-read on demand. The reader keeps the
 * last good answer on screen while the next read is in flight, so a refresh
 * never blanks the panel.
 */
export function useNativeWitness(key?: string, label?: string): Reading<NativeWitness> {
  const [data, setData] = useState<NativeWitness | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(true)
  const [readAt, setReadAt] = useState<number | null>(null)
  const mounted = useRef(true)
  const ticket = useRef(0)

  const read = useCallback(async () => {
    const current = ++ticket.current
    setReading(true)
    try {
      const witness = await readNativeWitness(key, label)
      if (!mounted.current || current !== ticket.current) return
      setData(witness)
      setError(null)
      setReadAt(Date.now())
    } catch (cause) {
      if (!mounted.current || current !== ticket.current) return
      setError(cause instanceof Error ? cause.message : 'the node did not answer')
    } finally {
      if (mounted.current && current === ticket.current) setReading(false)
    }
  }, [key, label])

  useEffect(() => {
    mounted.current = true
    void read()
    return () => {
      mounted.current = false
    }
  }, [read])

  return { data, error, reading, readAt, read }
}

/** The EVM side of the same question, answered by the node itself. */
export function useEvmProbe(): Reading<EvmWitnessProbe> {
  const [data, setData] = useState<EvmWitnessProbe | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(true)
  const [readAt, setReadAt] = useState<number | null>(null)
  const mounted = useRef(true)
  const ticket = useRef(0)

  const read = useCallback(async () => {
    const current = ++ticket.current
    setReading(true)
    try {
      const probe = await probeEvmWitness()
      if (!mounted.current || current !== ticket.current) return
      setData(probe)
      setError(null)
      setReadAt(Date.now())
    } catch (cause) {
      if (!mounted.current || current !== ticket.current) return
      setError(cause instanceof Error ? cause.message : 'the endpoint did not answer')
    } finally {
      if (mounted.current && current === ticket.current) setReading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void read()
    return () => {
      mounted.current = false
    }
  }, [read])

  return { data, error, reading, readAt, read }
}

/**
 * The native contracts module question, answered by the runtime's own export
 * table. Read once, on demand: the pallet set does not change between blocks
 * unless the node is upgraded.
 */
export function useNativeModuleProbe(): Reading<NativeModuleProbe> {
  const [data, setData] = useState<NativeModuleProbe | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(true)
  const [readAt, setReadAt] = useState<number | null>(null)
  const mounted = useRef(true)
  const ticket = useRef(0)

  const read = useCallback(async () => {
    const current = ++ticket.current
    setReading(true)
    try {
      const probe = await probeNativeModule()
      if (!mounted.current || current !== ticket.current) return
      setData(probe)
      setError(null)
      setReadAt(Date.now())
    } catch (cause) {
      if (!mounted.current || current !== ticket.current) return
      setError(cause instanceof Error ? cause.message : 'the node did not answer')
    } finally {
      if (mounted.current && current === ticket.current) setReading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void read()
    return () => {
      mounted.current = false
    }
  }, [read])

  return { data, error, reading, readAt, read }
}

export type ProofReader = {
  result: StorageProof | null
  error: string | null
  reading: boolean
  submitted: string | null
  run: (key: string) => Promise<void>
}

/**
 * Reads one storage proof for a key the visitor supplies. Invalid hex never
 * reaches the node: the caller validates first and the hook only fetches.
 */
export function useProofReader(defaultKey: string | null): ProofReader {
  const [result, setResult] = useState<StorageProof | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [submitted, setSubmitted] = useState<string | null>(null)
  const mounted = useRef(true)
  const ticket = useRef(0)

  const run = useCallback(async (key: string) => {
    const current = ++ticket.current
    setSubmitted(key)
    setReading(true)
    setError(null)
    try {
      const proof = await readStorageProof(key)
      if (!mounted.current || current !== ticket.current) return
      setResult(proof)
    } catch (cause) {
      if (!mounted.current || current !== ticket.current) return
      setError(cause instanceof Error ? cause.message : 'the node did not answer')
      setResult(null)
    } finally {
      if (mounted.current && current === ticket.current) setReading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    if (defaultKey !== null) void run(defaultKey)
    return () => {
      mounted.current = false
    }
  }, [defaultKey, run])

  return { result, error, reading, submitted, run }
}
