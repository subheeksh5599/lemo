import { Gauge, KeyRound, Network, ShieldCheck, type LucideIcon } from 'lucide-react'

export type NavItem = {
  href: string
  label: string
  detail: string
  icon: LucideIcon
}

export const NAV: readonly NavItem[] = [
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

export function currentNav(pathname: string): NavItem | undefined {
  return NAV.find((item) => item.href === pathname)
}
