import type { Metadata } from 'next'

import { ConsoleProvider } from '@/components/console/console-provider'
import { ConsoleShell } from '@/components/console/shell'

export const metadata: Metadata = {
  title: 'LEMO console | Portaldot V3 readings',
  description:
    'Live readings from Portaldot V3: finalized heads, slot cadence, native storage records, and state trie witnesses verified in the browser.',
}

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConsoleProvider>
      <ConsoleShell>{children}</ConsoleShell>
    </ConsoleProvider>
  )
}
