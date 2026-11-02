import { REPO_URL, STATUS_ROWS } from '@/lib/lemo'

function statusClass(status: string) {
  if (status === 'Design') return 'badge badge--accent'
  if (status === 'Not demonstrated' || status === 'Not performed' || status === 'Not launched') {
    return 'badge badge--bad'
  }
  if (status === 'Blocked by WASM module' || status === 'Trusted checkpoint') {
    return 'badge badge--warn'
  }
  if (
    status === 'Contracts tested, not deployed' ||
    status === 'Tested in TS and Solidity'
  ) {
    return 'badge badge--ok'
  }
  if (status === 'Transport available' || status === 'Service only') return 'badge'
  return 'badge'
}

export function Status() {
  return (
    <section id="status" className="wrap border-t border-line py-20 md:py-28">
      <div className="max-w-[54ch]">
        <h2 className="text-ink">What is real, and what is not</h2>
        <p className="lede mt-4 text-[15.5px]">
          This repository describes a protocol design. Nothing here claims a
          deployed registry, a deployed token, or a completed audit.
        </p>
      </div>

      <table className="grid mt-10 md:mt-12 table-fixed">
        <caption className="hidden-a11y">
          Implementation state of each component in the repository
        </caption>
        <colgroup>
          <col className="w-[58%]" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Component</th>
            <th scope="col" className="num">
              State
            </th>
          </tr>
        </thead>
        <tbody>
          {STATUS_ROWS.map((row) => (
            <tr key={row.component}>
              <td className="pr-4 align-middle">{row.component}</td>
              <td className="num align-middle">
                <span className={statusClass(row.status)}>{row.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-baseline sm:justify-between">
        <p className="max-w-[62ch] text-[12.5px] leading-relaxed text-muted">
          The EVM endpoint does not implement eth_getProof, so no EVM witness is
          shown anywhere in this build. The console prints the node&apos;s own
          refusal.
        </p>
        <a
          href={`${REPO_URL}#acceptance-criteria`}
          target="_blank"
          rel="noreferrer"
          className="mono shrink-0 text-[11px] text-accent-bright underline decoration-accent-line underline-offset-4 hover:decoration-accent-bright"
        >
          acceptance criteria
        </a>
      </div>
    </section>
  )
}
