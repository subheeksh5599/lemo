import type { Metadata, Viewport } from 'next'

import './globals.css'
import { WalletProvider } from '@/components/wallet/wallet-provider'

export const metadata: Metadata = {
  metadataBase: new URL('https://lemo-ebon.vercel.app'),
  title: 'LEMO: One title, two runtimes',
  description:
    'LEMO is a design for one asset title across Portaldot native records and a Revive EVM representation, with finalized state proofs gating transfers. The native record exists today; the WASM contract module is not live.',
  alternates: {
    canonical: '/',
  },
  icons: {
    icon: [
      { url: '/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/lemo-mark.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'LEMO: One title, two runtimes',
    description:
      'A native record and an EVM representation, designed to be held to the same conditions by finalized state proofs.',
    type: 'website',
    url: '/',
  },
}

export const viewport: Viewport = {
  themeColor: '#070b12',
  colorScheme: 'dark',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  )
}
