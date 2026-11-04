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

/** Pages reached from inside other pages, not from the sidebar: named for the breadcrumb. */
const DETAIL: Record<string, { label: string; parent: string }> = {
  '/console/finality': { label: 'BEEFY signature check', parent: '/console/prove' },
  '/console/proofs': { label: 'Proof walk', parent: '/console' },
  '/console/verify': { label: 'Key verifier', parent: '/console' },
  '/console/network': { label: 'Network', parent: '/console' },
  '/console/legacy': { label: 'Earlier deployment', parent: '/console' },
}

export function currentNav(pathname: string): NavItem | undefined {
  const direct = NAV.find((item) => item.href === pathname)
  if (direct !== undefined) return direct
  const detail = DETAIL[pathname]
  if (detail !== undefined) {
    const parent = NAV.find((item) => item.href === detail.parent)
    return parent === undefined ? undefined : { ...parent, href: pathname, label: detail.label }
  }
  if (pathname.startsWith('/tx/')) {
    const parent = NAV.find((item) => item.href === '/console')
    return parent === undefined ? undefined : { ...parent, href: pathname, label: 'Transaction receipt' }
  }
  return undefined
}

/** The sidebar item a page belongs to, so a detail page keeps its section highlighted. */
export function sectionHref(pathname: string): string {
  return DETAIL[pathname]?.parent ?? (pathname.startsWith('/tx/') ? '/console' : pathname)
}
