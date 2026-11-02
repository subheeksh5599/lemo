'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { callContract, readBalance, verifierFunction } from '@/lib/flow/evm'
import { readMappedAccount, readNativeBalance, type MappedAccount } from '@/lib/flow/native'
import { statusWord, titleProofTuple, type ParsedProof, type ProofBinding } from '@/lib/flow/proof'
import { readFlowSnapshot, type FlowSnapshot } from '@/lib/flow/snapshot'

type Reading<T> = {
  data: T | null
  error: string | null
  reading: boolean
  readAt: number | null
  read: () => Promise<void>
}

/** The whole page's state, re-read on demand. The last good answer stays up. */
export function useFlowSnapshot(): Reading<FlowSnapshot> {
  const [data, setData] = useState<FlowSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(true)
  const [readAt, setReadAt] = useState<number | null>(null)
  const mounted = useRef(true)
  const ticket = useRef(0)

  const read = useCallback(async () => {
    const current = ++ticket.current
    setReading(true)
    try {
      const snapshot = await readFlowSnapshot()
      if (!mounted.current || current !== ticket.current) return
      setData(snapshot)
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

export type FundingReading = {
  mapped: MappedAccount | null
  mappedError: string | null
  /** Native tPOT behind the mapped account, in planck, from the runtime API. */
  native: bigint | null
  nativeError: string | null
  /** The same balance seen from the EVM side, for comparison. */
  evm: bigint | null
  evmError: string | null
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

/**
 * The funding panel's three reads. They are independent on purpose: a node that
 * refuses one runtime call still answers the others, and each absence is shown
 * where it happened rather than collapsing the panel.
 */
export function useFunding(address: string | null): Reading<FundingReading> {
  const [data, setData] = useState<FundingReading | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(address !== null)
  const [readAt, setReadAt] = useState<number | null>(null)
  const mounted = useRef(true)
  const ticket = useRef(0)

  const read = useCallback(async () => {
    if (address === null) {
      setData(null)
      setReading(false)
      return
    }

    const current = ++ticket.current
    setReading(true)

    const [mapped, native, evm] = await Promise.allSettled([
      readMappedAccount(address),
      readNativeBalance(address),
      readBalance(address),
    ])

    if (!mounted.current || current !== ticket.current) return

    setData({
      mapped: mapped.status === 'fulfilled' ? mapped.value : null,
      mappedError: mapped.status === 'rejected' ? message(mapped.reason, 'no account id') : null,
      native: native.status === 'fulfilled' ? native.value : null,
      nativeError:
        native.status === 'rejected' ? message(native.reason, 'no native balance') : null,
      evm: evm.status === 'fulfilled' ? evm.value : null,
      evmError: evm.status === 'rejected' ? message(evm.reason, 'no EVM balance') : null,
    })
    setError(null)
    setReadAt(Date.now())
    setReading(false)
  }, [address])

  useEffect(() => {
    mounted.current = true
    void read()
    return () => {
      mounted.current = false
    }
  }, [read])

  return { data, error, reading, readAt, read }
}

export type VerifiedRecord = {
  titleId: string
  chainId: bigint
  nativeAsset: string
  backing: string
  owner: string
  identityHash: string
  vestingHash: string
  permissionsHash: string
  evmContract: string
  revision: bigint
}

export type VerificationReading = {
  status: bigint
  statusWord: string
  record: VerifiedRecord
  /** The verifier's own recomputation of the record's commitment. */
  recomputedCommitment: string | null
  expectedCommitment: string
  commitmentMatches: boolean | null
  latencyMs: number
  readAt: number
}

function recordFrom(values: readonly unknown[]): VerifiedRecord {
  return {
    titleId: String(values[0] ?? ''),
    chainId: BigInt((values[1] as bigint | undefined) ?? 0n),
    nativeAsset: String(values[2] ?? ''),
    backing: String(values[3] ?? ''),
    owner: String(values[4] ?? ''),
    identityHash: String(values[5] ?? ''),
    vestingHash: String(values[6] ?? ''),
    permissionsHash: String(values[7] ?? ''),
    evmContract: String(values[8] ?? ''),
    revision: BigInt((values[9] as bigint | undefined) ?? 0n),
  }
}

/**
 * A read-only walk: hand the verifier the proof and the gate's own commitment,
 * then ask the verifier to recompute that commitment from the record it decoded.
 * Two independent answers have to agree before the panel calls it proven.
 */
export function useVerification(verifierAddress: string | null) {
  const [result, setResult] = useState<VerificationReading | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const mounted = useRef(true)
  const ticket = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback(
    async (proof: ParsedProof, binding: ProofBinding, expectedCommitment: string) => {
      if (verifierAddress === null) {
        setError('the verifier address is not configured')
        return
      }

      const current = ++ticket.current
      const started = Date.now()
      setRunning(true)
      setError(null)

      try {
        const tuple = titleProofTuple(proof, binding)
        const [statusValue, recordValue] = await callContract(
          verifierAddress,
          verifierFunction('verifyTitle'),
          [tuple, expectedCommitment],
        )

        const record = recordFrom((recordValue as readonly unknown[]) ?? [])
        const status = BigInt((statusValue as bigint | undefined) ?? 0n)

        let recomputedCommitment: string | null = null
        try {
          const [commitment] = await callContract(
            verifierAddress,
            verifierFunction('commitmentOf'),
            [(recordValue as readonly unknown[]) ?? []],
          )
          recomputedCommitment = String(commitment).toLowerCase()
        } catch {
          recomputedCommitment = null
        }

        if (!mounted.current || current !== ticket.current) return

        setResult({
          status,
          statusWord: statusWord(status),
          record,
          recomputedCommitment,
          expectedCommitment: expectedCommitment.toLowerCase(),
          commitmentMatches:
            recomputedCommitment === null
              ? null
              : recomputedCommitment === expectedCommitment.toLowerCase(),
          readAt: Date.now(),
          latencyMs: Date.now() - started,
        })
      } catch (cause) {
        if (!mounted.current || current !== ticket.current) return
        setResult(null)
        setError(cause instanceof Error ? cause.message : 'the verifier did not answer')
      } finally {
        if (mounted.current && current === ticket.current) setRunning(false)
      }
    },
    [verifierAddress],
  )

  const clear = useCallback(() => {
    setResult(null)
    setError(null)
  }, [])

  return { result, error, running, run, clear }
}
