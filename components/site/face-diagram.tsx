import { FACES, TITLE } from '@/lib/lemo'

type NodeRow = { label: string; value: string }

const WASM_ROWS: NodeRow[] = FACES.wasm
const EVM_ROWS: NodeRow[] = FACES.erc20

const ARROW = 'url(#lemo-arrow-desktop)'
const ARROW_MOBILE = 'url(#lemo-arrow-mobile)'

/** One record card, drawn once and placed at two different sizes. */
function NodeCard({
  x,
  y,
  w,
  h,
  title,
  tag,
  rows,
  rowStart,
  rowStep,
  size,
}: {
  x: number
  y: number
  w: number
  h: number
  title: string
  tag: string
  rows: NodeRow[]
  rowStart: number
  rowStep: number
  size: number
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={4}
        className="fill-surface stroke-line-strong"
        strokeWidth={1}
      />
      <line
        x1={x}
        y1={y + 34}
        x2={x + w}
        y2={y + 34}
        className="stroke-line"
        strokeWidth={1}
      />
      <text
        x={x + 14}
        y={y + 22}
        className="fill-ink font-mono"
        fontSize={size}
        letterSpacing="0.1em"
      >
        {title}
      </text>
      <text
        x={x + w - 14}
        y={y + 22}
        textAnchor="end"
        className="fill-muted font-mono"
        fontSize={size - 1.5}
        letterSpacing="0.09em"
      >
        {tag}
      </text>
      {rows.map((row, index) => (
        <g key={row.label}>
          <text
            x={x + 14}
            y={rowStart + index * rowStep}
            className="fill-muted"
            fontSize={size - 1}
          >
            {row.label}
          </text>
          <text
            x={x + w - 14}
            y={rowStart + index * rowStep}
            textAnchor="end"
            className="fill-ink font-mono"
            fontSize={size - 1}
          >
            {row.value}
          </text>
        </g>
      ))}
    </g>
  )
}

function Verifier({
  x,
  y,
  w,
  h,
  title,
  note,
  size,
}: {
  x: number
  y: number
  w: number
  h: number
  title: string
  note: string
  size: number
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={3}
        className="fill-raised stroke-accent-line"
        strokeWidth={1}
      />
      <text
        x={x + w / 2}
        y={y + 19}
        textAnchor="middle"
        className="fill-accent-bright font-mono"
        fontSize={size}
        letterSpacing="0.1em"
      >
        {title}
      </text>
      <text
        x={x + w / 2}
        y={y + 33}
        textAnchor="middle"
        className="fill-muted"
        fontSize={size - 1.5}
      >
        {note}
      </text>
    </g>
  )
}

function Arrow({
  d,
  marker,
  pulse = false,
}: {
  d: string
  marker: string
  pulse?: boolean
}) {
  return (
    <g>
      <path
        d={d}
        fill="none"
        className="stroke-line-bright"
        strokeWidth={1}
        markerEnd={marker}
      />
      {pulse ? (
        <path
          d={d}
          fill="none"
          strokeLinecap="round"
          strokeDasharray="3 21"
          className="stroke-accent-bright"
          style={{ animation: 'lemo-proof-travel 3.4s linear infinite' }}
          strokeWidth={1.5}
        />
      ) : null}
    </g>
  )
}

/**
 * The dual-face protocol as a diagram: a native record on the left, an EVM
 * representation on the right, and the two gates that sit between them. The
 * travelling dash is the proof being checked, once per direction.
 */
export function FaceDiagram() {
  return (
    <figure className="mt-12 md:mt-14">
      {/* The travelling dash is the proof being checked. Unitless dash offsets
          are ignored in CSS, so the keyframe states the length in px. */}
      <style>{`@keyframes lemo-proof-travel { from { stroke-dashoffset: 0px } to { stroke-dashoffset: -24px } }`}</style>
      <svg
        viewBox="0 0 760 300"
        role="img"
        aria-labelledby="face-diagram-title face-diagram-desc"
        className="mx-auto hidden h-auto w-full max-w-[840px] md:block"
      >
        <title id="face-diagram-title">How a title crosses between the two runtimes</title>
        <desc id="face-diagram-desc">
          A transfer on the EVM face sends a finalized native proof to the EVM
          verifier before it settles. An unbond on the native face sends a
          finalized EVM proof to the native verifier before backing unlocks.
        </desc>
        <defs>
          <marker
            id="lemo-arrow-desktop"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0 0.7 L7.4 4 L0 7.3 Z" className="fill-line-bright" />
          </marker>
        </defs>

        <NodeCard
          x={0}
          y={18}
          w={226}
          h={232}
          title="NATIVE RECORD"
          tag="NATIVE"
          rows={WASM_ROWS}
          rowStart={76}
          rowStep={30}
          size={11.5}
        />

        <NodeCard
          x={534}
          y={18}
          w={226}
          h={232}
          title="EVM REPRESENTATION"
          tag="MARKET"
          rows={EVM_ROWS}
          rowStart={76}
          rowStep={30}
          size={11.5}
        />

        <Verifier
          x={302}
          y={64}
          w={156}
          h={46}
          title="EVM VERIFIER"
          note="native proof, current rev"
          size={10.5}
        />
        <Verifier
          x={302}
          y={191}
          w={156}
          h={46}
          title="NATIVE VERIFIER"
          note="supply and retirement"
          size={10.5}
        />

        <text
          x={380}
          y={150}
          textAnchor="middle"
          className="fill-muted font-mono"
          fontSize={9.5}
          letterSpacing="0.14em"
        >
          FINALIZED STATE ONLY
        </text>

        <Arrow d="M226 87 H296" marker={ARROW} pulse />
        <Arrow d="M464 87 H531" marker={ARROW} />
        <Arrow d="M534 214 H466" marker={ARROW} pulse />
        <Arrow d="M296 214 H228" marker={ARROW} />
      </svg>

      <svg
        viewBox="0 0 320 512"
        role="img"
        aria-labelledby="face-diagram-title-m face-diagram-desc-m"
        className="mx-auto h-auto w-full max-w-[520px] md:hidden"
      >
        <title id="face-diagram-title-m">How a title crosses between the two runtimes</title>
        <desc id="face-diagram-desc-m">
          A transfer on the EVM face sends a finalized native proof to the EVM
          verifier before it settles. An unbond on the native face sends a
          finalized EVM proof to the native verifier before backing unlocks.
        </desc>
        <defs>
          <marker
            id="lemo-arrow-mobile"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0 0.7 L7.4 4 L0 7.3 Z" className="fill-line-bright" />
          </marker>
        </defs>

        <NodeCard
          x={0}
          y={0}
          w={320}
          h={200}
          title="NATIVE RECORD"
          tag="NATIVE"
          rows={WASM_ROWS}
          rowStart={58}
          rowStep={26}
          size={11}
        />

        <Arrow d="M160 200 V212" marker={ARROW_MOBILE} pulse />
        <Verifier
          x={16}
          y={216}
          w={288}
          h={42}
          title="EVM VERIFIER"
          note="native proof, current rev"
          size={10.5}
        />
        <Arrow d="M160 258 V264" marker={ARROW_MOBILE} />

        <Verifier
          x={16}
          y={268}
          w={288}
          h={42}
          title="NATIVE VERIFIER"
          note="supply and retirement"
          size={10.5}
        />
        <Arrow d="M160 310 V322" marker={ARROW_MOBILE} pulse />

        <NodeCard
          x={0}
          y={326}
          w={320}
          h={176}
          title="EVM REPRESENTATION"
          tag="MARKET"
          rows={EVM_ROWS}
          rowStart={384}
          rowStep={26}
          size={11}
        />
      </svg>

      <figcaption className="mt-4 flex flex-col gap-1.5 text-[11.5px] leading-relaxed text-muted sm:flex-row sm:flex-wrap sm:gap-x-8">
        <span>Transfer: the EVM face verifies a finalized native proof.</span>
        <span>Unbond: the native face verifies a finalized EVM proof.</span>
        <span className="mono text-[10.5px] text-muted">revision {TITLE.revision}</span>
      </figcaption>
    </figure>
  )
}
