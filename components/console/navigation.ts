import {
  ArrowLeftRight,
  Gauge,
  KeyRound,
  Network,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'

export type NavItem = {
  href: string
  label: string
  detail: string
  icon: LucideIcon
}

/** Sections that only read the chain. */
export const NAV_READ: readonly NavItem[] = [
  {
    href: '/console',
    label: 'Overview',
    detail: 'Finalized head, slot cadence, native and Revive',
    icon: Gauge,
  },
  {
    href: '/console/proofs',
    label: 'Proofs',
    detail: 'Native witness and the EVM probe',
    icon: ShieldCheck,
  },
  {
    href: '/console/verify',
    label: 'Verify key',
    detail: 'Prove one storage key against the state root',
    icon: KeyRound,
  },
  {
    href: '/console/network',
    label: 'Network',
    detail: 'Endpoints, checks and latency',
    icon: Network,
  },
]

/** Sections that can change state on chain. */
export const NAV_ACT: readonly NavItem[] = [
  {
    href: '/console/flow',
    label: 'Transactions',
    detail: 'Mint, transfer and verify through the gate',
    icon: ArrowLeftRight,
  },
]

/** Kept as one list for callers that do not care about the grouping. */
export const NAV: readonly NavItem[] = [...NAV_READ, ...NAV_ACT]

export function currentNav(pathname: string): NavItem | undefined {
  return NAV.find((item) => item.href === pathname)
}
