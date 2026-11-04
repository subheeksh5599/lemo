import {
  ArrowLeftRight,
  BadgeCheck,
  Gauge,
  HardDrive,
  History,
  KeyRound,
  Network,
  ShieldCheck,
  Signature,
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
    href: '/console/finality',
    label: 'Validator-signed roots',
    detail: 'BEEFY signatures, MMR root and header, checked here and on-chain',
    icon: Signature,
  },
  {
    href: '/console/network',
    label: 'Network',
    detail: 'Endpoints, checks and latency',
    icon: Network,
  },
  {
    href: '/console/legacy',
    label: 'Earlier deployment',
    detail: 'EVM-only title and token; settled receipts',
    icon: History,
  },
  {
    href: '/console/local',
    label: 'Local lifecycle',
    detail: 'Recorded devnet run: title, proof, mint, unbond',
    icon: HardDrive,
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
  {
    href: '/console/prove',
    label: 'Prove native state',
    detail: 'A native account, proven by the EVM verifier against the validator-signed root',
    icon: BadgeCheck,
  },
]

/** Kept as one list for callers that do not care about the grouping. */
export const NAV: readonly NavItem[] = [...NAV_READ, ...NAV_ACT]

export function currentNav(pathname: string): NavItem | undefined {
  return NAV.find((item) => item.href === pathname)
}
