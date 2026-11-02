'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Activity } from 'lucide-react'

import {
  EVM_RPC,
  NATIVE_RPC,
  median,
  readEvmHead,
  readNativeBlocks,
  readNativeHead,
  type EvmHead,
  type NativeHead,
} from '@/lib/chain'
import { clockTime, formatInt, seconds } from '@/lib/format'

const HEAD_POLL_MS = 20_000
const SLOT_POLL_MS = 80_000
const STALE_AFTER_MS = 75_000
const SLOT_SAMPLE = 5
const SLOT_FIRST_DELAY_MS = 2_500
const SLOT_RETRY_MS = 6_000

type State = 'reading' | 'live' | 'partial' | 'stale' | 'unreachable'

function hostOf(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function messageOf(reason: unknown) {
  return reason instanceof Error ? reason.message : 'the node did not answer'
}

function dotClass(state: State) {
  if (state === 'live') return 'live-dot'
  if (state === 'unreachable') return 'live-dot live-dot--down'
  return 'live-dot live-dot--stale'
}

function badgeClass(state: State) {
  if (state === 'live') return 'badge badge--ok'
  if (state === 'unreachable') return 'badge badge--bad'
  if (state === 'reading') return 'badge'
  return 'badge badge--warn'
}

function stateLabel(state: State) {
  if (state === 'live') return 'live'
  if (state === 'partial') return 'one node'
  if (state === 'stale') return 'stale'
  if (state === 'unreachable') return 'unreachable'
  return 'reading'
}

/** A figure that flashes when its value changes, and stays still when it does not. */
function Figure({ value, emphasis = false }: { value: string; emphasis?: boolean }) {
  const reduce = useReducedMotion()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // `useReducedMotion` is null on the server, so the first client render has to
  // agree with SSR before the preference is honoured.
  const initial = mounted && reduce ? false : { opacity: 0.4 }

  return (
    <motion.dd
      key={value}
      initial={initial}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={`mt-2 font-mono text-[clamp(1.3rem,2.1vw,1.75rem)] leading-none tracking-[-0.03em] tabular-nums ${
        value === 'n/a'
          ? 'text-muted'
          : emphasis
            ? 'text-accent-bright'
            : 'text-ink'
      }`}
    >
      {value}
    </motion.dd>
  )
}

function Cell({
  label,
  value,
  meta,
  emphasis,
  warn = false,
}: {
  label: string
  value: string
  meta: string
  emphasis?: boolean
  warn?: boolean
}) {
  return (
    <div className="min-w-0 border-b border-line py-4 last:border-b-0 sm:border-b-0 sm:border-l sm:px-5 sm:first:border-l-0 sm:first:pl-0">
      <dt className="meta">{label}</dt>
      <Figure value={value} emphasis={emphasis} />
      <p
        className={`mono mt-2 truncate text-[10.5px] tabular-nums ${
          warn ? 'text-warn' : 'text-muted'
        }`}
        title={meta}
      >
        {meta}
      </p>
    </div>
  )
}

/**
 * Reads both runtimes over JSON-RPC: the native finalized head, the gap between
 * best and finalized, the median slot across recent finalized blocks, and the
 * Revive head. Each runtime is judged on its own, so a single dead endpoint
 * never blanks the figures the other one returned.
 */
export function LiveNetworkStrip() {
  const [native, setNative] = useState<NativeHead | null>(null)
  const [evm, setEvm] = useState<EvmHead | null>(null)
  const [nativeError, setNativeError] = useState<string | null>(null)
  const [evmError, setEvmError] = useState<string | null>(null)
  const [slotMs, setSlotMs] = useState<number | null>(null)
  const [slotSamples, setSlotSamples] = useState(0)
  const [slotError, setSlotError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  const [reading, setReading] = useState(true)
  const mounted = useRef(true)

  const readHeads = useCallback(async () => {
    const [nativeRead, evmRead] = await Promise.allSettled([
      readNativeHead(),
      readEvmHead(),
    ])
    if (!mounted.current) return

    if (nativeRead.status === 'fulfilled') {
      setNative(nativeRead.value)
      setNativeError(null)
    } else {
      setNativeError(messageOf(nativeRead.reason))
    }

    if (evmRead.status === 'fulfilled') {
      setEvm(evmRead.value)
      setEvmError(null)
    } else {
      setEvmError(messageOf(evmRead.reason))
    }

    if (nativeRead.status === 'fulfilled' || evmRead.status === 'fulfilled') {
      setUpdatedAt(Date.now())
    }
    setNow(Date.now())
    setReading(false)
  }, [])

  const readSlots = useCallback(async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const blocks = await readNativeBlocks(SLOT_SAMPLE)
        if (!mounted.current) return
        const intervals = blocks
          .map((block) => block.intervalMs)
          .filter((interval): interval is number => interval !== null && interval > 0)
        setSlotMs(median(intervals))
        setSlotSamples(intervals.length)
        setSlotError(null)
        return
      } catch (cause) {
        if (!mounted.current) return
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, SLOT_RETRY_MS))
          if (!mounted.current) return
          continue
        }
        setSlotMs(null)
        setSlotError(messageOf(cause))
      }
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void readHeads()

    const first = window.setTimeout(() => void readSlots(), SLOT_FIRST_DELAY_MS)
    const heads = window.setInterval(() => void readHeads(), HEAD_POLL_MS)
    const slots = window.setInterval(() => void readSlots(), SLOT_POLL_MS)
    const clock = window.setInterval(() => setNow(Date.now()), 15_000)

    return () => {
      mounted.current = false
      window.clearTimeout(first)
      window.clearInterval(heads)
      window.clearInterval(slots)
      window.clearInterval(clock)
    }
  }, [readHeads, readSlots])

  const stale = updatedAt !== null && now - updatedAt > STALE_AFTER_MS
  const failed = (nativeError !== null ? 1 : 0) + (evmError !== null ? 1 : 0)

  const state: State =
    updatedAt === null && failed === 0
      ? reading
        ? 'reading'
        : 'stale'
      : failed === 2
        ? 'unreachable'
        : stale
          ? 'stale'
          : failed === 1
            ? 'partial'
            : 'live'

  const lag =
    native === null ? null : Math.max(0, native.best - native.finalized.number)

  return (
    <section aria-labelledby="live-heading" className="border-y border-line bg-surface/40">
      <div className="wrap">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Activity
              aria-hidden="true"
              className="size-3.5 text-accent-bright"
              strokeWidth={1.6}
            />
            <h2 id="live-heading" className="text-[12px] font-medium text-ink">
              Live network
            </h2>
            <span
              role="status"
              aria-live="polite"
              className={`${badgeClass(state)} gap-1.5`}
            >
              <span className={dotClass(state)} aria-hidden="true" />
              {stateLabel(state)}
            </span>
            {stale && updatedAt !== null ? (
              <span className="mono text-[10.5px] text-warn">no fresh read</span>
            ) : null}
          </div>

          <p className="mono text-[10.5px] tabular-nums text-muted">
            {updatedAt === null ? 'not read yet' : `last read ${clockTime(updatedAt)} local`}
          </p>
        </div>

        <dl className="grid grid-cols-1 border-t border-line sm:grid-cols-2 md:grid-cols-4">
          <Cell
            label="Finalized head"
            value={native === null ? 'n/a' : formatInt(native.finalized.number)}
            meta={
              native === null
                ? nativeError === null
                  ? 'waiting for the native node'
                  : nativeError
                : `${native.chain}, best block ${formatInt(native.best)}`
            }
            emphasis={native !== null}
            warn={native === null}
          />
          <Cell
            label="Finality lag"
            value={lag === null ? 'n/a' : `${formatInt(lag)} blocks`}
            meta={lag === null ? 'needs the native head' : 'best minus finalized'}
            warn={lag === null}
          />
          <Cell
            label="Median slot"
            value={slotMs === null ? 'n/a' : seconds(slotMs)}
            meta={
              slotError !== null
                ? slotError
                : slotSamples === 0
                  ? 'sampling finalized blocks'
                  : `${slotSamples} intervals, finalized blocks`
            }
            warn={slotError !== null}
          />
          <Cell
            label="Revive head"
            value={evm === null ? 'n/a' : formatInt(evm.head)}
            meta={
              evm === null
                ? evmError === null
                  ? 'waiting for the EVM node'
                  : evmError
                : `chain ID ${evm.chainId}`
            }
            emphasis={evm !== null}
            warn={evm === null}
          />
        </dl>

        {failed > 0 ? (
          <p className="border-t border-line py-2.5 text-[11.5px] leading-relaxed text-warn">
            {failed === 2
              ? 'Neither runtime answered. A cell marked n/a has no value, and none is substituted.'
              : 'One runtime did not answer. Its cells show n/a rather than a substituted figure.'}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-line py-2.5">
          <p className="mono text-[10px] text-muted">
            native {hostOf(NATIVE_RPC)}
            <span aria-hidden="true" className="px-2 text-line-bright">
              /
            </span>
            execution {hostOf(EVM_RPC)}
          </p>
          <p className="text-[10.5px] text-muted">
            JSON-RPC, public Portaldot V3 testnet
          </p>
        </div>
      </div>
    </section>
  )
}
