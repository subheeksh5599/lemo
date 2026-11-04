import { ArrowLeftRight, BadgeCheck, Gauge, HardDrive, type LucideIcon } from 'lucide-react'

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
    href: '/console/local',
    label: 'Local lifecycle',
    detail: 'Both rules end to end on a runtime with the title pallet',
    icon: HardDrive,
  },
]

/** Sections that change state on chain, signed by the visitor's wallet. */
export const NAV_ACT: readonly NavItem[] = [
  {
    href: '/console/flow',
    label: 'Transact',
    detail: 'Create a native title, mint the EVM token against its proof, transfer, freeze',
    icon: ArrowLeftRight,
  },
  {
    href: '/console/prove',
    label: 'Verify',
    detail: 'Any native account proven by the EVM verifier; advance the validator-signed feed',
    icon: BadgeCheck,
  },
]

/** Kept as one list for callers that do not care about the grouping. */
export const NAV: readonly NavItem[] = [...NAV_READ, ...NAV_ACT]

export function currentNav(pathname: string): NavItem | undefined {
  return NAV.find((item) => item.href === pathname)
}
