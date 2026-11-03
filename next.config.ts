import type { NextConfig } from 'next'

/**
 * Security headers (audit L-08).
 *
 * This app is served by `next start` / Vercel (no `output: 'export'`), so
 * `headers()` applies to every route, including static pages and `/public`.
 *
 * - `script-src 'unsafe-inline'`: Next's App Router injects inline bootstrap
 *   scripts; without a per-request nonce (which would force dynamic rendering
 *   of every page) they need this. `'wasm-unsafe-eval'` lets
 *   `@polkadot/util-crypto` compile its hashing WebAssembly; it does not allow
 *   JS `eval`. `'unsafe-eval'` is added in development only, where React needs it.
 * - `connect-src`: same origin (the `/api/rpc/*` proxy) plus the Portaldot V3
 *   RPC hosts, and any absolute RPC override baked into the build.
 * - `img-src 'self' data:`: wallet icons are restricted to data URIs, so no
 *   wallet can turn its logo into a remote request.
 */

const PORTALDOT_RPC_SOURCES = [
  'https://test-evm-rpc-v3.portaldot.dev',
  'https://test-node-v3.portaldot.dev',
  'wss://test-node-v3.portaldot.dev',
]

function originOf(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === '') return null
  try {
    const url = new URL(raw)
    if (!['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol)) return null
    return `${url.protocol}//${url.host}`
  } catch {
    // Relative paths (the default `/api/rpc/...`) are covered by 'self'.
    return null
  }
}

function contentSecurityPolicy(): string {
  const isDev = process.env.NODE_ENV === 'development'

  const connect = new Set(["'self'", ...PORTALDOT_RPC_SOURCES])
  for (const raw of [process.env.NEXT_PUBLIC_NATIVE_RPC, process.env.NEXT_PUBLIC_EVM_RPC]) {
    const origin = originOf(raw)
    if (origin !== null) connect.add(origin)
  }
  if (isDev) connect.add('ws:') // HMR socket

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      "'wasm-unsafe-eval'",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': [...connect],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  }

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
