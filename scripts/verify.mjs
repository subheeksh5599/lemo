#!/usr/bin/env node
/**
 * LEMO preflight. The gate that runs before submission.
 *
 * Order of work:
 *   1. production build (`next build`) and a freshness assertion on .next
 *   2. start the real production server on a free port, wait for readiness
 *   3. fetch every route plus /lemo-mark.svg, assert 200 and non-empty HTML
 *   4. assert nav labels, page headings, in-page anchors, and that the page's
 *      own script and stylesheet resolve (a 200 page whose bundle 404s is a lie)
 *   5. scan the RENDERED html for banned strings and honesty violations
 *   6. probe both RPC endpoints from this machine (delegated to check-rpc.mjs)
 *   7. print PASS / FAIL / PENDING / HEURISTIC rows and exit
 *
 * Rules encoded here, from the LEMO brief:
 *   - no em dash (U+2014), no en dash used as a separator (U+2013 between
 *     digits is a numeric range and is allowed)
 *   - no lorem ipsum, TODO, "coming soon", "mock", "placeholder", "Acme",
 *     "John Doe". Narrow allowlist: the word "specimen" is honest product copy
 *     and is never banned; the HTML attribute placeholder="..." is real UI, the
 *     word used as body copy is not
 *   - the landing page must label its title record as a specimen
 *   - no claim that a registry or token is deployed, and no bare 40 hex
 *     address on the landing page (nothing is deployed on the testnet)
 *   - the landing page must state at least one explicit limitation
 *   - both RPC endpoints must answer from this machine with chain id 420420777
 *
 * Statuses:
 *   PASS      asserted and true
 *   FAIL      asserted and false. Exit 1.
 *   PENDING   a route or label a parallel workstream has not landed yet.
 *             Never reported as PASS. Exit 2 so the gate stays closed.
 *   HEURISTIC reported for a human, never counted as a pass. Horizontal
 *             overflow cannot be measured without a browser viewport, so the
 *             server-side proxy is a viewport meta plus responsive classes.
 *
 * Usage:
 *   node scripts/verify.mjs [--skip-build] [--port 3411] [--timeout 90]
 *                           [--json] [--verbose]
 *
 * Exit: 0 all pass, 1 any fail, 2 pending only, 130 interrupted.
 * Artifacts go to $LEMO_VERIFY_OUT or the OS temp dir. Nothing is written
 * inside the repository.
 */

import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { runRpcChecks } from './check-rpc.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = process.env.LEMO_VERIFY_OUT ?? path.join(tmpdir(), 'lemo-verify')
const NEXT_BIN = path.join(ROOT, 'node_modules', '.bin', 'next')

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const hasFlag = (name) => argv.includes(name)

function optionValue(name) {
  const index = argv.indexOf(name)
  if (index !== -1 && argv[index + 1] && !argv[index + 1].startsWith('--')) {
    return argv[index + 1]
  }
  const inline = argv.find((value) => value.startsWith(`${name}=`))
  return inline === undefined ? null : inline.slice(name.length + 1)
}

const opts = {
  build: !hasFlag('--skip-build'),
  port: optionValue('--port') === null ? null : Number(optionValue('--port')),
  readyTimeoutMs: Math.max(5, Number(optionValue('--timeout') ?? 90)) * 1000,
  buildTimeoutMs: 600_000,
  json: hasFlag('--json'),
  verbose: hasFlag('--verbose'),
  selfTest: hasFlag('--self-test'),
}

if (opts.port !== null && !Number.isInteger(opts.port)) {
  console.error(`--port needs an integer, got "${optionValue('--port')}"`)
  process.exit(64)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const note = (line = '') => process.stdout.write(`${line}\n`)
const clip = (text, max = 2200) => {
  const flat = String(text).trimEnd()
  return flat.length > max ? `${flat.slice(0, max)}...` : flat
}
const lastLines = (text, count = 16) => clip(text.trimEnd().split('\n').slice(-count).join('\n'))

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

const results = []
const add = (section, name, status, detail, brief = null) => {
  results.push({ section, name, status, detail: String(detail), brief: brief === null ? String(detail) : String(brief) })
  return status
}
const count = (status) => results.filter((row) => row.status === status).length

/** Pulls the lines a human needs out of a Next build failure. */
function buildErrorSummary(output) {
  const interesting = output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) =>
      /(^|\s)(Error:|Module not found|Failed to compile|Type error:|Cannot find module|Export .* doesn't exist|Unhandled Runtime)/i.test(
        line,
      ),
    )
    .filter((line) => !/^\s*at <unknown>/.test(line))
  const unique = [...new Set(interesting)]
  if (unique.length > 0) return unique.slice(0, 8)

  const fallback = output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !/^\s*at /.test(line))
  return fallback.slice(-8)
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server = null
let serverLog = ''
let serverExit = null
let chosenPort = null

function descendants(rootPid) {
  const out = []
  let listing
  try {
    listing = execFileSync('ps', ['-eo', 'pid=,ppid=,command='], { encoding: 'utf8' })
  } catch {
    return out
  }

  const byParent = new Map()
  for (const line of listing.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (!match) continue
    const pid = Number(match[1])
    const ppid = Number(match[2])
    if (!byParent.has(ppid)) byParent.set(ppid, [])
    byParent.get(ppid).push(pid)
  }

  const queue = [rootPid]
  while (queue.length > 0) {
    const current = queue.shift()
    for (const child of byParent.get(current) ?? []) {
      out.push(child)
      queue.push(child)
    }
  }
  return out
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function listenersOn(port) {
  try {
    const out = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out
      .split('\n')
      .map((value) => Number(value.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
  } catch {
    return []
  }
}

async function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, '127.0.0.1')
  })
}

async function pickPort(start) {
  for (let port = start; port < start + 40; port += 1) {
    if (await portIsFree(port)) return port
  }
  throw new Error(`no free port in ${start}-${start + 39}`)
}

/**
 * Kill the wrapper and its child (next start spawns next-server), then anything
 * still holding the port. The pgrep fallback uses the bracket-safe pattern
 * "[n]ext-server", which cannot match the pattern string in pgrep's own command
 * line, and only fires for a pid that also owns OUR port (the port was free
 * before we started, so any listener there belongs to this run).
 */
async function stopServer() {
  if (stopPromise !== null) return stopPromise
  stopPromise = (async () => {
    const pid = server?.pid ?? null
    // Never touch a listener we did not start: a port conflict is our error,
    // not permission to kill whatever answered first.
    const group = pid === null ? [] : [pid, ...descendants(pid)]
    const extra = pid !== null && chosenPort !== null ? listenersOn(chosenPort) : []

    if (pid !== null) {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        /* group already gone */
      }
      for (const target of group) {
        try {
          process.kill(target, 'SIGTERM')
        } catch {
          /* already gone */
        }
      }
    }

    const deadline = Date.now() + 6000
    while (Date.now() < deadline) {
      const held = group.some(alive) || (chosenPort !== null && listenersOn(chosenPort).length > 0)
      if (!held) break
      await sleep(200)
    }

    for (const target of new Set([
      ...(pid === null ? [] : [pid, ...group]),
      ...extra,
      ...(pid !== null && chosenPort !== null ? listenersOn(chosenPort) : []),
    ])) {
      try {
        process.kill(target, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }

    try {
      if (pid === null) throw new Error('no server of our own')
      const strays = execFileSync('pgrep', ['-f', '[n]ext-server'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .split('\n')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0 && value !== process.pid)

      for (const target of strays) {
        if (chosenPort === null) break
        const command = execFileSync('ps', ['-o', 'command=', '-p', String(target)], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        })
        if (!command.includes(`port ${chosenPort}`) && !command.includes(`-p ${chosenPort}`)) continue
        try {
          process.kill(target, 'SIGKILL')
        } catch {
          /* already gone */
        }
      }
    } catch {
      /* pgrep exits 1 when nothing matches, which is the good case */
    }

    const stillHeld = pid !== null && chosenPort !== null && listenersOn(chosenPort).length > 0
    server = null
    return !stillHeld
  })()
  try {
    return await stopPromise
  } finally {
    stopPromise = null
  }
}

let stopPromise = null
let interrupted = false
async function handleSignal(signal) {
  if (interrupted) return
  interrupted = true
  note(`\n${signal}: stopping the server on ${chosenPort === null ? 'no port' : `port ${chosenPort}`}`)
  await stopServer()
  process.exit(130)
}

process.on('SIGINT', () => void handleSignal('SIGINT'))
process.on('SIGTERM', () => void handleSignal('SIGTERM'))
process.on('SIGHUP', () => void handleSignal('SIGHUP'))
process.on('exit', () => {
  if (server?.pid) {
    try {
      process.kill(-server.pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }
})

function startServer(port) {
  const child = spawn(NEXT_BIN, ['start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
  })
  child.stdout.on('data', (chunk) => {
    serverLog += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    serverLog += chunk.toString()
  })
  child.on('exit', (code, signal) => {
    serverExit = { code, signal }
  })
  return child
}

async function waitForReady(base, timeoutMs) {
  const started = Date.now()
  let lastError = 'no response'

  while (Date.now() - started < timeoutMs) {
    if (interrupted) return { ok: false, interrupted: true, reason: 'interrupted by signal' }
    if (serverExit !== null) {
      return {
        ok: false,
        reason: `server exited early (code ${serverExit.code}${serverExit.signal ? `, ${serverExit.signal}` : ''})`,
      }
    }
    try {
      const response = await fetch(`${base}/`, {
        headers: { accept: 'text/html' },
        signal: AbortSignal.timeout(5000),
      })
      await response.text()
      return { ok: true, status: response.status, ms: Date.now() - started }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      await sleep(400)
    }
  }

  return { ok: false, reason: `no response in ${Math.round(timeoutMs / 1000)}s (${lastError})` }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function newestSourceMtime() {
  let newest = 0
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      try {
        newest = Math.max(newest, statSync(full).mtimeMs)
      } catch {
        /* unreadable file */
      }
    }
  }
  for (const dir of ['app', 'components', 'lib', 'hooks', 'public']) {
    walk(path.join(ROOT, dir))
  }
  return newest
}

function execute(command, commandArgs, { timeoutMs, logPath }) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', CI: '1' },
    })

    let output = ''
    let settled = false
    let timer = null

    const finish = (code, reason) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      if (logPath) {
        try {
          writeFileSync(logPath, output)
        } catch {
          /* best effort */
        }
      }
      resolve({ code, output, reason })
    }

    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.on('error', (error) => finish(-1, error.message))
    child.on('exit', (code, signal) => finish(code ?? -1, signal === null ? null : `signal ${signal}`))

    timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        /* already gone */
      }
      finish(-2, `timeout after ${Math.round(timeoutMs / 1000)}s`)
    }, timeoutMs)
  })
}

async function runBuild() {
  if (!existsSync(NEXT_BIN)) {
    add('build', 'next binary', 'FAIL', `missing ${NEXT_BIN}. Run npm install.`)
    return false
  }

  const started = Date.now()
  const logPath = path.join(OUT_DIR, 'build.log')
  note('building: next build')
  const result = await execute(NEXT_BIN, ['build'], { timeoutMs: opts.buildTimeoutMs, logPath })
  const seconds = ((Date.now() - started) / 1000).toFixed(1)

  if (opts.verbose) note(lastLines(result.output, 40))

  if (result.code !== 0) {
    const summary = buildErrorSummary(result.output).join('\n')
    add(
      'build',
      'next build',
      'FAIL',
      `exit ${result.code}${result.reason ? ` (${result.reason})` : ''} in ${seconds}s\n${summary}\nlog: ${logPath}`,
      `exit ${result.code}${result.reason ? ` (${result.reason})` : ''} in ${seconds}s: ${summary.split('\n')[0]} (log: ${logPath})`,
    )
    return false
  }

  const buildIdPath = path.join(ROOT, '.next', 'BUILD_ID')
  if (!existsSync(buildIdPath)) {
    add('build', 'next build', 'FAIL', `exit 0 but no .next/BUILD_ID after ${seconds}s`)
    return false
  }

  add('build', 'next build', 'PASS', `exit 0 in ${seconds}s`)

  const artifactAt = statSync(path.join(ROOT, '.next', 'BUILD_ID')).mtimeMs
  const sourceAt = newestSourceMtime()
  const fresh = buildIdPath !== null && artifactAt >= sourceAt - 1000
  add(
    'build',
    'artifact newer than sources',
    fresh ? 'PASS' : 'FAIL',
    `artifact ${new Date(artifactAt).toISOString()}, newest source ${new Date(sourceAt).toISOString()}` +
      (fresh ? '' : ' (STALE: rebuild before trusting any page below)'),
  )
  return fresh
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

const ROUTES = [
  {
    path: '/',
    kind: 'landing',
    nav: ['Protocol', 'Status'],
    consoleHref: '/console',
  },
  { path: '/console', kind: 'console', heading: 'Overview', headingPattern: /overview|portaldot/i },
  { path: '/console/proofs', kind: 'console', heading: 'Proofs', headingPattern: /proof/i },
  { path: '/console/network', kind: 'console', heading: 'Network', headingPattern: /network/i },
  {
    path: '/console/verify',
    kind: 'console',
    heading: 'Verify',
    headingPattern: /verify/i,
    pendingIf404: true,
  },
]

const CONSOLE_NAV = ['Overview', 'Proofs', 'Network']

async function fetchPage(base, route) {
  const started = Date.now()
  const response = await fetch(`${base}${route}`, {
    headers: {
      accept: route.endsWith('.svg') ? 'image/svg+xml' : 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  })
  const body = await response.text()
  return {
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    body,
    ms: Date.now() - started,
  }
}

function heading(html) {
  const match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  if (match === null) return null
  return match[1]
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function contextsFor(html, character, limit = 4) {
  const out = []
  let index = html.indexOf(character)
  while (index !== -1 && out.length < limit) {
    out.push(html.slice(Math.max(0, index - 40), index + 40).replace(/\s+/g, ' '))
    index = html.indexOf(character, index + 1)
  }
  return out
}

function enDashSeparators(html) {
  const out = []
  for (let index = 0; index < html.length; index += 1) {
    if (html[index] !== '\u2013') continue
    const before = html[index - 1] ?? ''
    const after = html[index + 1] ?? ''
    if (/[0-9]/.test(before) && /[0-9]/.test(after)) continue
    out.push(html.slice(Math.max(0, index - 40), index + 40).replace(/\s+/g, ' '))
    if (out.length >= 4) break
  }
  return out
}

function entityDashes(html) {
  const out = []
  const re = /&(?:mdash|ndash);|\\u201[34]/gi
  let match
  while ((match = re.exec(html)) !== null && out.length < 4) {
    out.push(html.slice(Math.max(0, match.index - 30), match.index + 45).replace(/\s+/g, ' '))
  }
  return out
}

const BANNED = [
  { id: 'em dash (U+2014)', scan: (html) => contextsFor(html, '\u2014') },
  { id: 'en dash as separator (U+2013)', scan: enDashSeparators },
  { id: 'escaped dash entity', scan: entityDashes },
  { id: 'lorem ipsum', pattern: /\blorem\s+ipsum\b/gi },
  { id: 'TODO', scan: (html) => contextsForRegex(html, /\bTODO\b/g) },
  { id: 'coming soon', pattern: /\bcoming\s+soon\b/gi },
  { id: 'mock', pattern: /\bmock(?:s|ed|ing)?\b/gi },
  { id: 'placeholder', pattern: /\bplaceholder\b/gi, allowAttribute: true },
  { id: 'Acme', pattern: /\bacme\b/gi },
  { id: 'John Doe', pattern: /\bjohn\s+doe\b/gi },
]

function contextsForRegex(html, regex, limit = 4) {
  const out = []
  const re = new RegExp(regex.source, regex.flags)
  let match
  while ((match = re.exec(html)) !== null && out.length < limit) {
    out.push(html.slice(Math.max(0, match.index - 45), match.index + match[0].length + 45).replace(/\s+/g, ' '))
  }
  return out
}

function scanBanned(html) {
  const findings = []

  for (const rule of BANNED) {
    if (typeof rule.scan === 'function') {
      const hits = rule.scan(html)
      if (hits.length > 0) findings.push({ rule: rule.id, hits })
      continue
    }

    const re = new RegExp(rule.pattern.source, rule.pattern.flags)
    const hits = []
    let match
    while ((match = re.exec(html)) !== null && hits.length < 4) {
      const after = html.slice(match.index + match[0].length, match.index + match[0].length + 3)
      // Narrow allowlist: placeholder="..." is a real input attribute. The word
      // used as body copy is still a failure.
      if (rule.allowAttribute && /^\s*=/.test(after)) continue
      hits.push(
        html.slice(Math.max(0, match.index - 45), match.index + match[0].length + 45).replace(/\s+/g, ' '),
      )
    }
    if (hits.length > 0) findings.push({ rule: rule.id, hits })
  }

  return findings
}

const DEPLOY_CLAIMS = [
  {
    id: 'registry claimed live or deployed',
    re: /\bregistry\b[^.<]{0,60}\b(?:is|are|now)\b[^.<]{0,24}\b(?:live|deployed|running)\b/gi,
  },
  {
    id: 'token claimed live or deployed',
    re: /\btoken\b[^.<]{0,60}\b(?:is|are|now)\b[^.<]{0,24}\b(?:live|deployed|running)\b/gi,
  },
  {
    id: 'claims a registry, token or contract was deployed or launched',
    re: /\b(?:deployed|launched|shipped)\b[^.<]{0,30}\b(?:registry|token|contract)\b/gi,
  },
  { id: 'claims the product is live on testnet', re: /\blive on (?:the )?(?:portaldot )?testnet\b/gi },
]

function scanDeployClaims(html) {
  const findings = []
  for (const rule of DEPLOY_CLAIMS) {
    const re = new RegExp(rule.re.source, rule.re.flags)
    let match
    while ((match = re.exec(html)) !== null) {
      // Judge the whole sentence: an honest sentence that denies deployment
      // ("Nothing here claims a deployed registry") must not be flagged, while
      // an affirmative claim in a neighbouring sentence still is.
      const start = Math.max(0, html.lastIndexOf('.', match.index) + 1)
      let end = html.indexOf('.', match.index)
      if (end === -1) end = Math.min(html.length, match.index + 240)
      const sentence = html.slice(start, end + 1)
      const negated = /\b(?:no|not|nothing|never|isn't|aren't|without|none)\b/i.test(sentence)
      if (negated) continue
      findings.push({
        rule: rule.id,
        context: sentence.replace(/\s+/g, ' ').trim().slice(0, 140),
      })
      break
    }
  }
  return findings
}

function bareAddresses(html) {
  const out = []
  const re = /\b0x[0-9a-fA-F]{40}\b/g
  let match
  while ((match = re.exec(html)) !== null && out.length < 4) out.push(match[0])
  return out
}

const LIMITATION_MARKERS =
  /\b(?:not demonstrated|not deployed|not built|not implemented|design only|specification only|no registry|nothing is deployed)\b/i

function unresolvedAnchors(html) {
  const ids = new Set()
  const idRe = /id="([^"]+)"/g
  let id
  while ((id = idRe.exec(html)) !== null) ids.add(id[1])

  const missing = []
  const hrefRe = /href="(#[^"]*)"/g
  let href
  while ((href = hrefRe.exec(html)) !== null) {
    const target = href[1].slice(1)
    if (target === '' || target === 'top') continue
    if (!ids.has(target) && !missing.includes(href[1])) missing.push(href[1])
  }
  return missing
}

function responsiveSignals(html) {
  return {
    viewport: /<meta[^>]+name="viewport"[^>]*>/i.test(html),
    breakpoints: (html.match(/\b(?:sm|md|lg|xl|2xl):[a-z[-]/g) ?? []).length,
  }
}

function assetRefs(html) {
  return {
    script: /<script[^>]+src="([^"]+\.js[^"]*)"/i.exec(html)?.[1] ?? null,
    style: /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/i.exec(html)?.[1] ?? null,
  }
}

function checkRoutePage(route, page, verifyRouteExists) {
  const label = route.path
  const body = page.body
  const markup = body.replace(/<script[\s\S]*?<\/script>/gi, '')

  if (markup.length <= 1500) {
    add('route', label, 'FAIL', `HTTP 200 but only ${markup.length} bytes of markup (empty shell?)`)
    return null
  }

  add('route', label, 'PASS', `HTTP 200, ${body.length} bytes, ${markup.length} bytes of markup, ${page.ms}ms`)

  const title = heading(body)
  if (route.kind === 'landing') {
    const ok = title !== null && title.split(/\s+/).length >= 2 && title.length <= 90
    add('heading', `${label} h1`, ok ? 'PASS' : 'FAIL', title === null ? 'no <h1> found' : `"${title}"`)
  } else {
    const ok = title !== null && route.headingPattern.test(title)
    add(
      'heading',
      `${label} h1`,
      ok ? 'PASS' : 'FAIL',
      title === null
        ? 'no <h1> found'
        : `"${title}" (expected the ${route.heading} page heading, matching ${route.headingPattern})`,
    )
  }

  const navLabels = route.kind === 'landing' ? route.nav : CONSOLE_NAV
  for (const navLabel of navLabels) {
    add(
      'heading',
      `${label} nav "${navLabel}"`,
      body.includes(navLabel) ? 'PASS' : 'FAIL',
      body.includes(navLabel) ? 'label present in rendered html' : 'label absent from rendered html',
    )
  }

  if (route.kind === 'console' && verifyRouteExists && route.path !== '/console/verify') {
    add(
      'heading',
      `${label} nav "Verify"`,
      body.includes('Verify') ? 'PASS' : 'FAIL',
      body.includes('Verify')
        ? 'label present in rendered html'
        : 'a verify page exists but the console nav has no Verify entry',
    )
  }

  if (route.consoleHref) {
    const present = new RegExp(`href="${route.consoleHref}"`).test(body)
    add('heading', `${label} console link`, present ? 'PASS' : 'FAIL', `href="${route.consoleHref}" ${present ? 'found' : 'missing'}`)
  }

  const missing = unresolvedAnchors(body)
  add(
    'heading',
    `${label} anchors resolve`,
    missing.length === 0 ? 'PASS' : 'FAIL',
    missing.length === 0 ? 'every in-page href has a matching id' : `no target for ${missing.join(', ')}`,
  )

  const banned = scanBanned(body)
  const short = (text, max = 90) => {
    const flat = String(text).replace(/\s+/g, ' ').trim()
    return flat.length > max ? `${flat.slice(0, max)}...` : flat
  }
  add(
    'copy',
    `${label} banned strings`,
    banned.length === 0 ? 'PASS' : 'FAIL',
    banned.length === 0
      ? 'no banned token in the rendered html'
      : `${banned
          .slice(0, 3)
          .map((finding) => `${finding.rule}: "${short(finding.hits[0])}"`)
          .join(' | ')}${banned.length > 3 ? ` | +${banned.length - 3} more rules` : ''}`,
  )

  const claims = scanDeployClaims(body)
  add(
    'honesty',
    `${label} no deploy claim`,
    claims.length === 0 ? 'PASS' : 'FAIL',
    claims.length === 0
      ? 'no claim that a registry, token or contract is deployed or live'
      : claims.map((claim) => `${claim.rule}: "${claim.context}"`).join(' | '),
  )

  if (route.kind === 'landing') {
    const addresses = bareAddresses(body)
    add(
      'honesty',
      `${label} no contract address`,
      addresses.length === 0 ? 'PASS' : 'FAIL',
      addresses.length === 0 ? 'no bare 40 hex address on the marketing page' : `found ${addresses.join(', ')}`,
    )

    add(
      'honesty',
      `${label} specimen labelled`,
      /specimen/i.test(body) ? 'PASS' : 'FAIL',
      /specimen/i.test(body) ? 'the title record is labelled a specimen' : 'no "specimen" label in the rendered html',
    )

    const limitation = body.match(LIMITATION_MARKERS)
    add(
      'honesty',
      `${label} limitation stated`,
      limitation === null ? 'FAIL' : 'PASS',
      limitation === null
        ? 'no explicit not-demonstrated / not-deployed statement found'
        : `states "${limitation[0]}"`,
    )
  }

  const signals = responsiveSignals(body)
  add(
    'heuristic',
    `${label} responsive`,
    'HEURISTIC',
    `viewport meta ${signals.viewport ? 'yes' : 'no'}, ${signals.breakpoints} breakpoint classes. Horizontal overflow at 390px needs a browser; this is a proxy, not a pass`,
  )
  if (!signals.viewport) add('heuristic', `${label} viewport meta`, 'FAIL', 'no <meta name="viewport"> in rendered html')
  if (signals.breakpoints === 0) add('heuristic', `${label} breakpoint classes`, 'FAIL', 'no sm:/md:/lg: class in rendered html')

  return body
}

async function checkRoutes(base) {
  const fetched = new Map()

  for (const route of ROUTES) {
    try {
      fetched.set(route.path, await fetchPage(base, route.path))
    } catch (error) {
      fetched.set(route.path, { error })
    }
  }

  const verifyPage = fetched.get('/console/verify')
  const verifyRouteExists =
    verifyPage !== undefined && verifyPage.error === undefined && verifyPage.status === 200

  const bodies = new Map()
  for (const route of ROUTES) {
    const page = fetched.get(route.path)

    if (page.error !== undefined) {
      add('route', route.path, 'FAIL', `fetch failed: ${page.error instanceof Error ? page.error.message : page.error}`)
      continue
    }

    if (page.status === 404 && route.pendingIf404) {
      add('route', route.path, 'PENDING', 'route not built yet, console workstream has not landed it')
      continue
    }

    if (page.status !== 200) {
      add('route', route.path, 'FAIL', `HTTP ${page.status} (${page.type || 'no content-type'})`)
      continue
    }

    const body = checkRoutePage(route, page, verifyRouteExists)
    if (body !== null) bodies.set(route.path, body)
  }

  // Page-specific headings: two console pages sharing one h1 is a copy-paste
  // title, and the nav then lies about where you are.
  const titles = new Map()
  for (const route of ROUTES) {
    if (route.kind !== 'console') continue
    const body = bodies.get(route.path)
    if (body === undefined) continue
    const title = heading(body)
    if (title !== null) titles.set(route.path, title.toLowerCase())
  }
  const seen = new Map()
  const duplicates = []
  for (const [routePath, title] of titles) {
    if (seen.has(title)) duplicates.push(`${seen.get(title)} and ${routePath} both say "${title}"`)
    else seen.set(title, routePath)
  }
  add(
    'heading',
    'console headings are page-specific',
    duplicates.length === 0 ? 'PASS' : 'FAIL',
    duplicates.length === 0 ? `${titles.size} pages, ${seen.size} distinct h1` : duplicates.join('; '),
  )

  // Internal links must resolve. A nav entry pointing at a page that does not
  // exist is the same defect as a dead anchor, one level up.
  const links = new Set()
  for (const body of bodies.values()) {
    for (const match of body.matchAll(/href="(\/[^"#]*)"/g)) links.add(match[1].split('?')[0])
  }
  const broken = []
  for (const link of links) {
    if (link === '/console/verify' && !verifyRouteExists) continue
    try {
      const response = await fetch(`${base}${link}`, { redirect: 'follow', signal: AbortSignal.timeout(15_000) })
      await response.text()
      if (response.status >= 400) broken.push(`${link} -> HTTP ${response.status}`)
    } catch (error) {
      broken.push(`${link} -> ${error instanceof Error ? error.message : error}`)
    }
  }
  add(
    'heading',
    'internal links resolve',
    broken.length === 0 ? 'PASS' : 'FAIL',
    broken.length === 0 ? `${links.size} internal links all answered` : broken.join(', '),
  )

  return bodies
}

async function checkAssets(base, bodies) {
  try {
    const asset = await fetchPage(base, '/lemo-mark.svg')
    const isSvg = /<svg[\s>]/i.test(asset.body)
    add(
      'asset',
      '/lemo-mark.svg',
      asset.status === 200 && isSvg ? 'PASS' : 'FAIL',
      `HTTP ${asset.status}, ${asset.type || 'no content-type'}, ${asset.body.length} bytes, svg root ${isSvg ? 'present' : 'absent'}`,
    )
  } catch (error) {
    add('asset', '/lemo-mark.svg', 'FAIL', `fetch failed: ${error instanceof Error ? error.message : error}`)
  }

  const landing = bodies.get('/')
  if (landing === undefined) return

  for (const [kind, reference] of Object.entries(assetRefs(landing))) {
    if (reference === null) {
      add('asset', `landing ${kind} chunk`, 'FAIL', 'the landing page references no such asset')
      continue
    }
    try {
      const response = await fetch(new URL(reference, base))
      const text = await response.text()
      add(
        'asset',
        `landing ${kind} chunk`,
        response.ok && text.length > 1000 ? 'PASS' : 'FAIL',
        `${reference} -> HTTP ${response.status}, ${text.length} bytes`,
      )
    } catch (error) {
      add('asset', `landing ${kind} chunk`, 'FAIL', `${reference}: ${error instanceof Error ? error.message : error}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Self-test: prove the detectors can fail. A gate that only ever passes
// certifies nothing, so each scanner runs against a fixture that MUST trip it
// and one that MUST be allowed.
// ---------------------------------------------------------------------------

function runSelfTests() {
  const flagged = (html, scan = scanBanned) => scan(html).length > 0
  const clean = (html, scan = scanBanned) => scan(html).length === 0
  const address = `0x${'a'.repeat(40)}`

  const cases = [
    ['em dash is caught', flagged('<p>one \u2014 two</p>')],
    ['en dash used as a separator is caught', flagged('<p>one \u2013 two</p>')],
    ['en dash between digits is allowed (numeric range)', clean('<p>blocks 10\u201320</p>')],
    ['escaped em dash sequence is caught', flagged('<script>{"text":"a\\u2014b"}</script>')],
    ['&mdash; entity is caught', flagged('<p>one &mdash; two</p>')],
    ['lorem ipsum is caught', flagged('<p>lorem ipsum dolor</p>')],
    ['TODO is caught', flagged('<p>TODO: wire this up</p>')],
    ['"coming soon" is caught', flagged('<p>Registry coming soon</p>')],
    ['"mock" is caught', flagged('<p>mock data for the demo</p>')],
    ['placeholder used as copy is caught', flagged('<p>placeholder text</p>')],
    ['placeholder="..." attribute is allowed', clean('<input placeholder="Filter keys" />')],
    ['Acme is caught', flagged('<p>Acme Corp</p>')],
    ['John Doe is caught', flagged('<p>John Doe, 0x123</p>')],
    ['the word specimen is allowed', clean('<p>Specimen record, not a live reading</p>')],
    ['a deployed-registry claim is caught', flagged('<p>Our registry is deployed on testnet.</p>', scanDeployClaims)],
    ['a deployed-token claim is caught', flagged('<p>The token is live now.</p>', scanDeployClaims)],
    ['an honest denial of deployment is allowed', clean('<p>Nothing here claims a deployed registry.</p>', scanDeployClaims)],
    ['a bare contract address is caught', bareAddresses(`<p>see ${address}</p>`).length === 1],
    ['ordinary prose has no contract address', bareAddresses('<p>state root 0x1234, no contract</p>').length === 0],
    ['an anchor with no target is caught', unresolvedAnchors('<a href="#missing">x</a><div id="other"></div>').length === 1],
    ['a resolving anchor is allowed', unresolvedAnchors('<a href="#status">x</a><div id="status"></div>').length === 0],
    ['a page without a viewport meta is caught', responsiveSignals('<html></html>').viewport === false],
    ['a page with a viewport meta passes that signal', responsiveSignals('<meta name="viewport" content="width=device-width">').viewport === true],
    ['breakpoint classes are counted', responsiveSignals('<div class="md:flex lg:grid">').breakpoints === 2],
  ]

  note('SELF-TEST (detectors must be able to fail)')
  let failed = 0
  for (const [name, ok] of cases) {
    if (!ok) failed += 1
    note(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  }
  note(`  ${cases.length - failed}/${cases.length} detector cases behave`)
  return failed === 0 ? 0 : 1
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const SECTION_ORDER = ['build', 'server', 'route', 'heading', 'copy', 'honesty', 'asset', 'heuristic', 'rpc']
const SECTION_TITLE = {
  build: 'BUILD',
  server: 'SERVER',
  route: 'ROUTES',
  heading: 'NAV AND HEADINGS',
  copy: 'COPY SCAN',
  honesty: 'HONESTY',
  asset: 'ASSETS',
  heuristic: 'HEURISTIC (not gated)',
  rpc: 'RPC',
}

function printReport(meta) {
  note('')
  note(`LEMO preflight  ${ROOT}`)
  note(
    `node ${process.version}  port ${meta.port ?? '-'}  build ${meta.built ? 'fresh' : 'skipped'}  ready ${meta.readyMs ?? '-'}`,
  )

  for (const section of SECTION_ORDER) {
    const rows = results.filter((row) => row.section === section)
    if (rows.length === 0) continue
    note('')
    note(SECTION_TITLE[section])
    const width = rows.reduce((max, row) => Math.max(max, row.name.length), 0)
    for (const row of rows) {
      note(`  ${row.status.padEnd(9)} ${row.name.padEnd(width)}  ${row.detail.replace(/\n/g, ' | ')}`)
    }
  }

  const failures = results.filter((row) => row.status === 'FAIL')
  const pending = results.filter((row) => row.status === 'PENDING')

  note('')
  note(
    `SUMMARY  ${count('PASS')} pass, ${failures.length} fail, ${pending.length} pending, ${count('HEURISTIC')} heuristic (reported, not gated)`,
  )

  if (pending.length > 0) {
    note('PENDING (not a pass: the gate stays closed until these land)')
    for (const row of pending) note(`  - ${row.name}: ${row.detail.replace(/\n/g, ' | ')}`)
  }

  if (failures.length > 0) {
    note('FAILURES')
    for (const row of failures) note(`  - ${row.name}: ${row.brief.replace(/\n/g, ' | ')}`)
  }

  const code = failures.length > 0 ? 1 : pending.length > 0 ? 2 : 0
  note('')
  note(
    code === 0
      ? 'EXIT 0  all assertions pass, the harness can gate submission'
      : code === 1
        ? 'EXIT 1  blocked by failures above'
        : 'EXIT 2  blocked: pending routes or labels remain',
  )
  return code
}

function writeReport(code, extra = {}) {
  if (!opts.json) return
  const target = path.join(OUT_DIR, 'last-run.json')
  try {
    writeFileSync(
      target,
      `${JSON.stringify({ root: ROOT, at: new Date().toISOString(), rows: results, code, ...extra }, null, 2)}\n`,
    )
    note(`json report: ${target}`)
  } catch (error) {
    note(`could not write json report: ${error instanceof Error ? error.message : error}`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (opts.selfTest) {
    return runSelfTests()
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const started = Date.now()
  note(`LEMO preflight: ${ROOT}`)

  let built = false
  if (opts.build) {
    built = await runBuild()
    if (count('FAIL') > 0) {
      const code = printReport({ port: null, built, readyMs: null })
      writeReport(code)
      return code
    }
  } else {
    add('build', 'next build', 'PENDING', 'skipped (--skip-build): serving whatever .next already holds')
    if (!existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) {
      add('build', 'production build present', 'FAIL', 'no .next/BUILD_ID. Run npm run build.')
      const code = printReport({ port: null, built, readyMs: null })
      writeReport(code)
      return code
    }
  }

  chosenPort = opts.port ?? (await pickPort(3411))
  if (!(await portIsFree(chosenPort))) {
    add(
      'server',
      'port available',
      'FAIL',
      `port ${chosenPort} is already in use and something else owns it. Pass --port <free port>.`,
    )
    const code = printReport({ port: chosenPort, built, readyMs: null })
    writeReport(code)
    return code
  }

  const base = `http://127.0.0.1:${chosenPort}`
  note(`starting production server on ${base}`)
  server = startServer(chosenPort)

  const ready = await waitForReady(base, opts.readyTimeoutMs)
  if (ready.interrupted || interrupted) {
    await stopServer()
    return 130
  }
  if (!ready.ok) {
    add('server', 'readiness', 'FAIL', `${ready.reason}. Server log: ${lastLines(serverLog, 12)}`)
    await stopServer()
    const code = printReport({ port: chosenPort, built, readyMs: null })
    writeReport(code)
    return code
  }
  add('server', 'readiness', 'PASS', `answered / with HTTP ${ready.status} in ${ready.ms}ms`)

  const bodies = await checkRoutes(base)
  await checkAssets(base, bodies)

  note('probing RPC endpoints')
  try {
    for (const row of await runRpcChecks()) add('rpc', row.id, row.status, row.detail)
  } catch (error) {
    add('rpc', 'rpc checks', 'FAIL', `probe crashed: ${error instanceof Error ? error.message : error}`)
  }

  const released = await stopServer()
  add('server', 'shutdown', released ? 'PASS' : 'FAIL', `port ${chosenPort} ${released ? 'released, no listener left' : 'STILL HELD after cleanup'}`)

  const code = printReport({ port: chosenPort, built, readyMs: ready.ms })
  writeReport(code, { durationMs: Date.now() - started })
  return code
}

main()
  .then(async (code) => {
    await stopServer()
    process.exitCode = code
  })
  .catch(async (error) => {
    note(`\nPREFLIGHT CRASHED: ${error instanceof Error ? error.stack : error}`)
    await stopServer()
    process.exitCode = 1
  })
