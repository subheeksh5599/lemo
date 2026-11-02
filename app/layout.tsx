import type { Metadata, Viewport } from 'next'

import './globals.css'

export const metadata: Metadata = {
  title: 'LEMO | One title across Portaldot native and Revive',
  description:
    'LEMO is a design for one asset title across Portaldot native records and a Revive EVM representation, with finalized state proofs gating transfers. The native record exists today; the WASM contract module is not live.',
  icons: { icon: '/lemo-mark.svg' },
  openGraph: {
    title: 'LEMO | One enforceable title across two runtimes',
    description:
      'A native record and an EVM representation, designed to be held to the same conditions by finalized state proofs.',
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: '#060a11',
  colorScheme: 'dark',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
