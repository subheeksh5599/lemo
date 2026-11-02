import Link from 'next/link'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Fingerprint,
  Layers3,
  Link2,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react'

import { Header } from '@/components/marketing/header'
import { InteractiveGlobe } from '@/components/marketing/interactive-globe'

function Eyebrow({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return (
    <p
      className={`font-mono text-[10.5px] font-medium tracking-[0.14em] ${
        light ? 'text-[#6e94ff]' : 'text-[#0428cb]'
      }`}
    >
      {children}
    </p>
  )
}

function PrimaryLink({
  href,
  children,
  light = false,
}: {
  href: string
  children: React.ReactNode
  light?: boolean
}) {
  return (
    <Link
      href={href}
      className={`inline-flex h-11 items-center gap-2 rounded-lg px-5 text-[14px] font-medium transition-opacity hover:opacity-90 ${
        light ? 'bg-white text-[#00052e]' : 'bg-[#0428cb] text-white'
      }`}
    >
      {children}
      <ArrowUpRight className="size-4" strokeWidth={1.7} aria-hidden="true" />
    </Link>
  )
}

function Hero() {
  return (
    <section className="relative overflow-hidden bg-[#00052e] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_closest-side_at_center,#06105a_0%,#00052e_86%)]" />
      <InteractiveGlobe />

      <div className="relative z-10 mx-auto flex min-h-svh max-w-[900px] flex-col items-center justify-center px-6 pb-24 pt-24 text-center">
        <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 font-mono text-[10.5px] font-medium tracking-[0.12em] text-white/85">
          <span className="size-1.5 rounded-full bg-[#adffce]" />
          PROVEN AGAINST PORTALDOT V3
        </div>

        <h1 className="max-w-[760px] text-[clamp(2.8rem,3.45vw,3.6rem)] font-normal leading-[1.22] tracking-[-0.04em]">
          One title.
          <br />
          Two runtimes.
        </h1>

        <p className="mt-6 max-w-[520px] text-[16px] leading-[1.55] text-white/90">
          One native record and one EVM representation, held to the same title.
          A finalized state proof decides who owns it, and every transfer has to
          prove the same revision.
        </p>

        <div className="mt-9">
          <PrimaryLink href="/console">Open the console</PrimaryLink>
        </div>

        <p className="mt-5 font-mono text-[10px] tracking-[0.08em] text-white/55">
          No wallet. No transaction. Read the live testnet first.
        </p>
      </div>
    </section>
  )
}

function ConsoleMockup() {
  return (
    <div className="relative mx-auto mt-16 w-full max-w-[1080px]">
      <div className="rounded-[32px] bg-[linear-gradient(145deg,#2a0a6a_0%,#4b1fa8_55%,#1b0a4a_100%)] p-3 shadow-[0_40px_120px_rgba(0,0,0,0.55)] md:p-5">
        <div className="overflow-hidden rounded-[22px] bg-[#f3f4fa] text-[#171a2b]">
          <div className="flex h-10 items-center gap-2 bg-[#171a2b] px-4">
            <span className="size-2 rounded-full bg-white/25" />
            <span className="size-2 rounded-full bg-white/25" />
            <span className="size-2 rounded-full bg-white/25" />
            <span className="mx-auto rounded-md bg-white/10 px-24 py-1 font-mono text-[9px] text-white/55">
              console.lemo.xyz
            </span>
          </div>

          <div className="grid grid-cols-[44px_minmax(0,1fr)] md:grid-cols-[52px_minmax(0,1fr)_250px]">
            <div className="flex flex-col items-center gap-4 border-r border-black/5 bg-white py-5">
              <span className="flex size-8 items-center justify-center rounded-full bg-[#0428cb] text-[13px] font-semibold text-white">
                l
              </span>
              <Layers3 className="size-4 text-[#8c92a3]" aria-hidden="true" />
              <ShieldCheck className="size-4 text-[#0428cb]" aria-hidden="true" />
              <Fingerprint className="size-4 text-[#8c92a3]" aria-hidden="true" />
              <Link2 className="size-4 text-[#8c92a3]" aria-hidden="true" />
            </div>

            <div className="min-w-0 bg-white px-4 py-4 md:px-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[14px] font-semibold">Title overview</p>
                  <p className="mt-0.5 text-[11px] text-[#8c92a3]">
                    Both faces at the current revision
                  </p>
                </div>
                <span className="rounded-full border border-[#e9e9f3] px-2.5 py-1 font-mono text-[9px] text-[#6b6b83]">
                  live read
                </span>
              </div>

              <div className="mt-4 grid grid-cols-3 divide-x divide-[#e9e9f3] rounded-lg border border-[#e9e9f3]">
                {[
                  ['Revisions', '07'],
                  ['Proof checks', '1,077'],
                  ['Blocked', '2'],
                ].map(([label, value]) => (
                  <div key={label} className="px-3 py-3">
                    <p className="font-mono text-[9px] text-[#8c92a3]">{label}</p>
                    <p className="mt-1 font-mono text-[18px] tabular-nums">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-[11px] font-medium">Current titles</p>
                <span className="font-mono text-[9px] text-[#8c92a3]">6 records</span>
              </div>

              <div className="mt-2 overflow-hidden rounded-lg border border-[#e9e9f3]">
                <div className="grid grid-cols-[1.2fr_0.8fr_0.5fr_0.8fr] bg-[#fafafd] px-3 py-2 font-mono text-[8.5px] text-[#8c92a3]">
                  <span>Title</span>
                  <span>Face</span>
                  <span>Rev</span>
                  <span>State</span>
                </div>
                {[
                  ['Black Shoes', 'Native', '07', 'Bound'],
                  ['Black Shoes', 'Revive', '07', 'Proven'],
                  ['Linen Jacket', 'Native', '03', 'Bound'],
                  ['Linen Jacket', 'Revive', '03', 'Proven'],
                ].map((row) => (
                  <div
                    key={`${row[0]}-${row[1]}`}
                    className="grid grid-cols-[1.2fr_0.8fr_0.5fr_0.8fr] items-center border-t border-[#e9e9f3] px-3 py-2 text-[10px]"
                  >
                    <span className="truncate">{row[0]}</span>
                    <span className="text-[#6b6b83]">{row[1]}</span>
                    <span className="font-mono tabular-nums">{row[2]}</span>
                    <span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#eafaf3] px-2 py-0.5 text-[8.5px] text-[#0a7a55]">
                        <Check className="size-2.5" aria-hidden="true" />
                        {row[3]}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="hidden border-l border-[#e9e9f3] bg-[#fafafd] px-4 py-4 md:block">
              <p className="text-[12px] font-semibold">Latest proof</p>
              <p className="mt-1 text-[10px] leading-4 text-[#6b6b83]">
                System.Number at the finalized head.
              </p>
              <div className="mt-4 space-y-3">
                {[
                  ['Nodes', '4'],
                  ['Bytes', '1,003'],
                  ['Root', '0x90d6…cbe5'],
                  ['Value', '0xff770400'],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3 border-b border-[#e9e9f3] pb-2">
                    <span className="text-[9.5px] text-[#8c92a3]">{label}</span>
                    <span className="font-mono text-[9.5px] tabular-nums">{value}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-md border border-[#bfe9d8] bg-[#effaf4] px-3 py-2">
                <p className="flex items-center gap-1.5 text-[9.5px] font-medium text-[#0a7a55]">
                  <CheckCircle2 className="size-3" aria-hidden="true" />
                  Proof verified
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#0b0d1a] px-4 py-2.5 text-white shadow-lg">
        <span className="flex size-6 items-center justify-center rounded-full bg-white text-[#00052e]">
          <ArrowRight className="size-3" strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="text-[11px] font-medium">Console preview</span>
        <span className="font-mono text-[9px] text-white/50">read only</span>
      </div>
    </div>
  )
}

function AdminSection() {
  return (
    <section className="relative bg-[#00052e] pb-24 text-white">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-8">
        <div className="mx-auto max-w-[760px] text-center">
          <h2 className="text-[clamp(2rem,3.6vw,3.2rem)] font-normal leading-[1.12] tracking-[-0.04em]">
            A second runtime creates a second record.
          </h2>
          <p className="mx-auto mt-6 max-w-[720px] text-[16px] leading-[1.65] text-white/70">
            Every representation means another owner field, another supply check,
            another revision to reconcile by hand. LEMO binds both faces to one
            title, so a second market does not mean a second source of truth.
          </p>
        </div>

        <div className="mx-auto mt-14 grid max-w-[900px] gap-8 border-t border-white/15 pt-7 text-left sm:grid-cols-3">
          {[
            ['1', 'Keep one owner across both faces.', 'The native record stays the source.'],
            ['2', 'Expire every stale proof.', 'A revision increment invalidates the old set.'],
            ['3', 'Refuse a transfer on either side.', 'One invariant, enforced twice.'],
          ].map(([number, heading, body]) => (
            <div key={number}>
              <p className="font-mono text-[11px] text-[#6e94ff]">{number}</p>
              <p className="mt-2 text-[14px] font-medium leading-snug">{heading}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-white/50">{body}</p>
            </div>
          ))}
        </div>

        <ConsoleMockup />
      </div>
    </section>
  )
}

function Stats() {
  return (
    <section id="stats" className="relative border-y border-white/15 bg-[#00052e] text-white">
      <div className="absolute inset-0 bg-white/[0.03]" />
      <div className="relative mx-auto max-w-[1400px] px-6 py-10 lg:px-8">
        <div className="grid grid-cols-2 items-start justify-items-center gap-x-8 gap-y-7 md:grid-cols-5">
          {[
            ['1,077', 'PROOF TESTS'],
            ['71', 'CONTRACT TESTS'],
            ['4', 'PROOF NODES'],
            ['2', 'RUNTIMES'],
            ['1', 'TITLE'],
          ].map(([value, label]) => (
            <div key={label} className="text-center">
              <p className="font-mono text-[28px] leading-none tabular-nums text-white/90">{value}</p>
              <p className="mt-2 font-mono text-[9.5px] tracking-[0.12em] text-white/40">{label}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-t border-white/15 pt-6">
          <span className="font-mono text-[9px] tracking-[0.14em] text-white/35">BUILT ON</span>
          {['Portaldot V3', 'Revive EVM', 'Substrate trie', 'Solidity', 'TypeScript'].map((name) => (
            <span key={name} className="text-[12px] font-medium text-white/55">
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

function FlowMockup() {
  return (
    <div className="rounded-[28px] bg-[#0b1230] p-4 shadow-[0_30px_70px_-30px_rgba(5,12,48,0.55)]">
      <div className="rounded-[18px] bg-white px-5 py-5">
        <div className="flex items-center justify-between border-b border-[#e9e9f3] pb-3">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-[#0428cb] text-[11px] font-semibold text-white">l</span>
            <p className="text-[12px] font-semibold">Connecting your systems</p>
          </div>
          <span className="font-mono text-[8.5px] text-[#8c92a3]">4 linked</span>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="space-y-2">
            {[
              ['Native record', Layers3],
              ['Revive EVM', Wallet],
              ['Indexer', RefreshCw],
              ['EVM wallet', Fingerprint],
            ].map(([name, Icon]) => {
              const Component = Icon as typeof Layers3
              return (
                <div key={name as string} className="flex items-center gap-2 rounded-md border border-[#e9e9f3] px-2.5 py-2">
                  <Component className="size-3.5 text-[#6b6b83]" aria-hidden="true" />
                  <span className="flex-1 text-[10.5px]">{name as string}</span>
                  <span className="flex size-4 items-center justify-center rounded-full bg-[#0428cb] text-white">
                    <Check className="size-2.5" aria-hidden="true" />
                  </span>
                </div>
              )
            })}
          </div>

          <ArrowRight className="size-4 text-[#8c92a3]" aria-hidden="true" />

          <div className="space-y-3">
            <div className="rounded-full bg-[#0428cb] px-3 py-2 text-center text-[10px] font-medium text-white">
              Bind the title
            </div>
            {['Title', 'Backing', 'Owner'].map((name) => (
              <div key={name} className="rounded-full border border-[#e9e9f3] px-3 py-2 text-center font-mono text-[9.5px] text-[#4f5166]">
                {name}
              </div>
            ))}
          </div>
        </div>

        <p className="mt-4 border-t border-[#e9e9f3] pt-3 text-[10px] text-[#8c92a3]">
          Every record, proof and transfer, connected to one title.
        </p>
      </div>
    </div>
  )
}

function WorkflowMockup() {
  return (
    <div className="rounded-[28px] bg-[#1a2b6d] p-4 shadow-[0_30px_70px_-30px_rgba(5,12,48,0.55)]">
      <div className="rounded-[18px] bg-white px-5 py-5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[8.5px] tracking-[0.1em] text-[#8c92a3]">NEW WORKFLOW</span>
          <span className="font-mono text-[8.5px] text-[#8c92a3]">10-min setup</span>
        </div>
        <p className="mt-2 text-[14px] font-semibold">What matters, and what to do</p>

        <div className="mt-4 divide-y divide-[#e9e9f3]">
          {[
            ['Backing check', 'Confirm the locked backing before a transfer settles'],
            ['Revision check', 'Refuse a proof from an older revision'],
            ['Owner identity', 'Match the native owner to the EVM holder'],
          ].map(([title, body], index) => (
            <div key={title} className="flex items-start justify-between gap-4 py-3">
              <div>
                <p className="text-[11.5px] font-medium">{title}</p>
                <p className="mt-0.5 text-[9.5px] leading-4 text-[#8c92a3]">{body}</p>
              </div>
              <span className={`mt-1 flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 ${index === 2 ? 'bg-[#e9e9f3]' : 'bg-[#0428cb]'}`}>
                <span className={`size-3 rounded-full bg-white ${index === 2 ? '' : 'ml-auto'}`} />
              </span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-md bg-[#f5f6fb] px-3 py-2">
          <CheckCircle2 className="size-3.5 text-[#0a7a55]" aria-hidden="true" />
          <p className="text-[9.5px] text-[#4f5166]">Saved. Runs on every transfer until the revision changes.</p>
        </div>
      </div>
    </div>
  )
}

function ThreadMockup() {
  return (
    <div className="rounded-[28px] bg-[#0b4f3f] p-4 shadow-[0_30px_70px_-30px_rgba(5,12,48,0.55)]">
      <div className="rounded-[18px] bg-white px-5 py-5">
        <div className="flex items-center gap-3 border-b border-[#e9e9f3] pb-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-[#e9e9f3] font-mono text-[9px] text-[#171a2b]">07</span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold">Black Shoes · Revision 07</p>
            <p className="text-[9.5px] text-[#8c92a3]">Native record · proof event</p>
          </div>
          <span className="rounded-full bg-[#eafaf3] px-2 py-0.5 font-mono text-[8px] text-[#0a7a55]">verified</span>
        </div>

        <div className="mt-4 space-y-4">
          <div className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#0428cb] text-[10px] font-semibold text-white">A</span>
            <div className="min-w-0">
              <p className="text-[10.5px] font-medium">Challenger <span className="font-normal text-[#8c92a3]">to LEMO</span> <span className="float-right font-mono text-[8.5px] text-[#8c92a3]">09:24</span></p>
              <p className="mt-1 text-[10.5px] leading-4 text-[#4f5166]">Does revision 07 still authorize the current EVM holder?</p>
              <p className="mt-1 font-mono text-[8.5px] text-[#8c92a3]">Opened 09:25</p>
            </div>
          </div>

          <div className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#e9e9f3] font-mono text-[9px] text-[#171a2b]">07</span>
            <div className="min-w-0">
              <p className="text-[10.5px] font-medium">LEMO <span className="font-normal text-[#8c92a3]">to Challenger</span> <span className="float-right font-mono text-[8.5px] text-[#8c92a3]">09:25</span></p>
              <p className="mt-1 text-[10.5px] leading-4 text-[#4f5166]">Yes. The finalized proof matches the current root. Transfer may settle.</p>
              <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-[#e9e9f3] px-2 py-1.5">
                <FileCheck2 className="size-3 text-[#6b6b83]" aria-hidden="true" />
                <span className="font-mono text-[8.5px] text-[#4f5166]">proof-rev07.json</span>
              </div>
              <p className="mt-1 font-mono text-[8.5px] text-[#8c92a3]">Opened by LEMO</p>
            </div>
          </div>
        </div>

        <p className="mt-4 border-t border-[#e9e9f3] pt-3 text-[9.5px] text-[#8c92a3]">
          Watching native state and the EVM verifier
        </p>
      </div>
    </div>
  )
}

function TransferMockup() {
  return (
    <div className="rounded-[28px] bg-[#0428cb] p-4 shadow-[0_30px_70px_-30px_rgba(5,12,48,0.55)]">
      <div className="rounded-[18px] bg-white px-5 py-5">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-semibold">Transfer request</p>
          <span className="rounded-full bg-[#eafaf3] px-2 py-0.5 font-mono text-[8px] text-[#0a7a55]">allowed</span>
        </div>

        <div className="mt-4 space-y-2.5">
          {[
            ['Title', '0x7f3a…9c4e'],
            ['Revision', '07'],
            ['Native owner', '0x4c1a…8f20'],
            ['EVM holder', '0x4c1a…8f20'],
            ['Backing', 'Locked'],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between border-b border-[#e9e9f3] pb-2">
              <span className="text-[9.5px] text-[#8c92a3]">{label}</span>
              <span className="font-mono text-[9.5px] tabular-nums">{value}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-md border border-[#bfe9d8] bg-[#effaf4] px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[10px] font-medium text-[#0a7a55]">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Authorized by the current revision
          </p>
          <p className="mt-1 text-[8.5px] leading-4 text-[#4f5166]">
            Both faces agree. A stale root would have reverted here.
          </p>
        </div>

        <div className="mt-3 flex items-center gap-2 text-[8.5px] text-[#8c92a3]">
          <Clock3 className="size-3" aria-hidden="true" />
          Settled in the next finalized block
        </div>
      </div>
    </div>
  )
}

const STEPS = [
  {
    eyebrow: 'ONE-TIME SETUP',
    title: 'Give them one record',
    body:
      'Link the native title to the Revive representation. The title keeps backing, owner, identity, vesting and permissions in one place, and both faces read the same record.',
    visual: <FlowMockup />,
  },
  {
    eyebrow: 'ONE-TIME SETUP',
    title: 'Give them one rule',
    body:
      'Teach the verifier what must be true before a transfer settles. Backing locked. Revision current. Owner matched. The rule is written once and enforced on every transfer.',
    visual: <WorkflowMockup />,
  },
  {
    eyebrow: 'RUNS ON EVERY TRANSFER',
    title: 'They watch every revision',
    body:
      'LEMO watches native state and the EVM verifier around the clock. The moment a revision changes, the old proof expires and the next transfer has to prove the new one.',
    visual: <ThreadMockup />,
  },
  {
    eyebrow: 'RUNS ON EVERY TRANSFER',
    title: 'They do the work',
    body:
      'Right on cue, the gate checks the proof and either settles the transfer or reverts it. The decision is not a dashboard warning. It is the transaction path.',
    visual: <TransferMockup />,
  },
]

function How() {
  return (
    <section id="how" className="scroll-mt-24 bg-white py-24 md:py-32">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-8">
        <div className="max-w-[900px]">
          <Eyebrow>HOW LEMO WORKS</Eyebrow>
          <h2 className="mt-5 text-[clamp(1.8rem,3vw,2.5rem)] font-normal leading-[1.25] tracking-[-0.035em] text-[#00052e]">
            Bind the title once. Then both runtimes enforce the same conditions,
            on every transfer.
          </h2>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-2.5">
          {['Connect', 'Onboard', 'Observe', 'Run'].map((step, index) => (
            <span key={step} className="flex items-center gap-2.5">
              {index === 0 ? (
                <span className="rounded-full bg-[#0428cb] px-4 py-2 text-[12px] font-medium text-white">
                  {step}
                </span>
              ) : (
                <span className="px-1 text-[12px] text-[#6b6b83]">{step}</span>
              )}
              {index < 3 ? <span className="text-[#b6b9c9]">/</span> : null}
            </span>
          ))}
          <span className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-[#0428cb]/25 px-3 py-1.5 text-[11px] text-[#0428cb]">
            <Check className="size-3" aria-hidden="true" />
            Runs 24/7
          </span>
        </div>

        <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 border-t border-[#e9e9f3] pt-5">
          {[
            'Title created',
            'Backing locked',
            'Revision published',
            'Proof verified',
            'Transfer settled',
            'Stale proof refused',
            'Owner changed',
            'Supply unchanged',
          ].map((item, index) => (
            <span key={item} className="inline-flex items-center gap-2 font-mono text-[9.5px] text-[#6b6b83]">
              <span className={`size-1.5 rounded-full ${index === 1 ? 'bg-[#0428cb]' : 'bg-[#34a789]'}`} />
              {item}
            </span>
          ))}
        </div>

        <div className="mt-16 space-y-24">
          {STEPS.map((step, index) => (
            <div key={step.title} className="grid items-center gap-10 lg:grid-cols-2 lg:gap-20">
              <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                <Eyebrow>{step.eyebrow}</Eyebrow>
                <h3 className="mt-3 text-[clamp(1.6rem,2.6vw,2.2rem)] font-normal leading-[1.15] tracking-[-0.035em] text-[#00052e]">
                  {step.title}
                </h3>
                <p className="mt-4 max-w-[460px] text-[15px] leading-[1.65] text-[#6b6b83]">
                  {step.body}
                </p>
              </div>
              <div className={index % 2 === 1 ? 'lg:order-1' : ''}>{step.visual}</div>
            </div>
          ))}
        </div>

        <div className="mt-16 border-t border-[#e9e9f3] pt-6">
          <p className="font-mono text-[9.5px] tracking-[0.12em] text-[#8c92a3]">
            CONNECT / ONBOARD / OBSERVE / RUN
          </p>
        </div>
      </div>
    </section>
  )
}

function Quote() {
  return (
    <section className="bg-[#efeff7] py-24 text-[#00052e]">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-8">
        <div className="grid items-stretch gap-8 lg:grid-cols-2">
          <figure className="flex flex-col justify-between">
            <blockquote className="text-[clamp(1.6rem,2.7vw,2.4rem)] font-normal leading-[1.28] tracking-[-0.03em]">
              “The unit of transfer authorization is not the token. It is the
              revisioned title binding backing, owner, identity, vesting and
              permissions.”
            </blockquote>
            <figcaption className="mt-10">
              <p className="text-[14px] font-medium">LEMO design note</p>
              <p className="mt-1 text-[12px] text-[#6b6b83]">The binding, not the bridge</p>
            </figcaption>
          </figure>

          <div className="grid grid-cols-2 gap-3">
            {[
              ['2', 'faces', 'Native record and Revive representation'],
              ['1', 'revision', 'One current state, old proofs expire'],
              ['0', 'synthetic supply', 'No uncontrolled mirror token'],
              ['4', 'proof nodes', 'A real System.Number capture'],
            ].map(([value, label, note]) => (
              <div key={label} className="rounded-[18px] bg-white p-6">
                <p className="font-mono text-[34px] leading-none tracking-[-0.04em] tabular-nums">{value}</p>
                <p className="mt-2 text-[12px] font-medium">{label}</p>
                <p className="mt-2 text-[11px] leading-5 text-[#6b6b83]">{note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 text-center">
          <PrimaryLink href="/console">Open the console</PrimaryLink>
        </div>
      </div>
    </section>
  )
}

function Security() {
  return (
    <section id="security" className="bg-[#00052e] py-20 text-white">
      <div className="mx-auto max-w-[900px] px-6 text-center">
        <Eyebrow light>VERIFICATION &amp; BOUNDARIES</Eyebrow>
        <h2 className="mt-4 text-[clamp(1.8rem,3vw,2.5rem)] font-normal leading-[1.25] tracking-[-0.035em]">
          A proof can be checked. A deployment is still missing.
        </h2>
        <p className="mx-auto mt-5 max-w-[680px] text-[14px] leading-[1.7] text-white/60">
          The trie verifier is checked against real finalized captures in TypeScript
          and Solidity. The native registry is not deployed, the WASM contracts
          module is not live, and the root feed is a trusted checkpoint. The landing
          page says that on purpose.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 font-mono text-[9.5px] tracking-[0.12em] text-white/45">
          <span>TRUSTED ROOT FEED</span>
          <span>TESTED, NOT DEPLOYED</span>
          <span>ETH_GETPROOF REFUSED</span>
        </div>
        <Link href="/console/network" className="mt-8 inline-flex items-center gap-1.5 text-[12px] text-[#6e94ff] hover:text-white">
          Read the network page
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    </section>
  )
}

const FAQS = [
  [
    'Does LEMO exist on a public chain?',
    'The proof verifier and the title design exist in code and are exercised against real Portaldot V3 state. The native WASM contracts module is listed for V3.0 and is not live. No LEMO registry is deployed.',
  ],
  [
    'What exactly is proven?',
    'A Substrate read proof for System.Number is decoded, walked against the finalized state root, and checked in both TypeScript and Solidity. The fixtures are real captures from the public testnet.',
  ],
  [
    'Which runtimes does it target?',
    'The Portaldot native runtime and Revive, its EVM runtime. The EVM endpoint reports chain ID 420420777. The design binds both faces to the same title revision.',
  ],
  [
    'Can I move a title today?',
    'No. The transfer path is designed and tested, but no gate is deployed. The console reads state; it does not send transactions.',
  ],
  [
    'Where does the state root come from?',
    'A trusted checkpoint, currently a single attester. That is a boundary of the design, not a trustless bridge. Replacing it is the next protocol step.',
  ],
  [
    'What is still missing?',
    'The native title registry, the live WASM module, and an independent root source. The contracts layer and the browser verifier are already tested.',
  ],
]

function Faq() {
  return (
    <section id="faq" className="bg-white py-24">
      <div className="mx-auto grid max-w-[1400px] gap-12 px-6 lg:grid-cols-2 lg:gap-16 lg:px-8">
        <div>
          <h2 className="text-[clamp(2rem,3.4vw,3rem)] font-normal leading-[1.1] tracking-[-0.04em] text-[#00052e]">
            Your questions,
            <br />
            answered.
          </h2>
          <p className="mt-5 max-w-[360px] text-[14px] leading-[1.7] text-[#6b6b83]">
            LEMO is a protocol design, so the honest answers matter more than the
            polished ones. If one is missing, open the console and read the state.
          </p>
          <Link href="/console" className="mt-6 inline-flex items-center gap-1.5 text-[13px] text-[#0428cb] hover:underline">
            console.lemo.xyz
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>

        <div className="divide-y divide-[#e9e9f3] border-t border-[#e9e9f3]">
          {FAQS.map(([question, answer]) => (
            <details key={question} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[14px] font-medium text-[#00052e] [&::-webkit-details-marker]:hidden">
                {question}
                <span className="font-mono text-[16px] text-[#8c92a3] group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-[560px] text-[13px] leading-[1.7] text-[#6b6b83]">
                {answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

function Cta() {
  return (
    <section className="border-t border-[#e9e9f3] bg-[#efeff7] py-24">
      <div className="mx-auto max-w-[760px] px-6 text-center">
        <h2 className="text-[clamp(2rem,3.6vw,3.2rem)] font-normal leading-[1.12] tracking-[-0.04em] text-[#00052e]">
          See the proof on a live network.
        </h2>
        <p className="mx-auto mt-5 max-w-[520px] text-[15px] leading-[1.65] text-[#6b6b83]">
          Open the console and read the finalized head, the storage proof, and the
          EVM refusal for yourself. No wallet required.
        </p>
        <div className="mt-8">
          <PrimaryLink href="/console">Open the console</PrimaryLink>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="bg-white pb-8 pt-16">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-8">
        <div className="grid gap-10 border-b border-[#e9e9f3] pb-12 md:grid-cols-[1.2fr_2fr]">
          <div>
            <Link href="/" className="flex items-center gap-2.5" aria-label="LEMO home">
              <span className="relative flex size-6 items-center justify-center">
                <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-sm bg-[#00052e]" />
                <span className="absolute right-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-sm bg-[#6e94ff]" />
                <span className="h-3 w-[3px] rounded-sm bg-[#0428cb]" />
              </span>
              <span className="text-[22px] font-semibold tracking-[-0.04em] text-[#00052e]">lemo</span>
            </Link>
            <p className="mt-4 max-w-[240px] text-[12px] leading-5 text-[#6b6b83]">
              A protocol design for one asset title across Portaldot native and
              Revive. Tested, not deployed.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {[
              ['PRODUCT', [['How it works', '#how'], ['Console', '/console'], ['Network', '/console/network']]],
              ['RESOURCES', [['Proof walk', '/console/proofs'], ['Key verifier', '/console/verify'], ['Evidence', '/console']]],
              ['COMPANY', [['Status', '#security'], ['FAQ', '#faq'], ['Protocol notes', '/console']]],
            ].map(([title, links]) => (
              <div key={title as string}>
                <p className="font-mono text-[9px] tracking-[0.14em] text-[#8c92a3]">{title as string}</p>
                <ul className="mt-4 space-y-2.5">
                  {(links as string[][]).map(([label, href]) => (
                    <li key={label}>
                      <Link href={href} className="text-[12px] text-[#4f5166] hover:text-[#00052e]">
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-6 text-[10.5px] text-[#8c92a3] sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 LEMO. Protocol design, not deployed.</p>
          <p className="font-mono">Portaldot V3 · Revive · Substrate trie</p>
        </div>
      </div>
    </footer>
  )
}

export function Landing() {
  return (
    <div className="bg-white text-[#00052e]">
      <Header />
      <main>
        <Hero />
        <AdminSection />
        <Stats />
        <How />
        <Quote />
        <Security />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </div>
  )
}
