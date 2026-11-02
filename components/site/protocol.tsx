import { FaceDiagram } from '@/components/site/face-diagram'

const FACES = [
  {
    name: 'The native record',
    runtime: 'native runtime',
    body:
      'Holds the backing, the owner, identity status, vesting conditions and the permissions on the account. This side decides whether the asset still qualifies for its title.',
    items: ['Backing and ownership', 'Identity and vesting', 'Proxy or multisig control'],
  },
  {
    name: 'The market representation',
    runtime: 'Revive',
    body:
      'An ERC-20 or ERC-721 that Solidity applications already understand, issued against the same title identifier and tied to the revision it last accepted.',
    items: ['Token supply and holders', 'Transfers through EVM apps', 'Last accepted revision'],
  },
]

export function Protocol() {
  return (
    <section id="protocol" className="wrap border-t border-line py-20 md:py-28">
      <div className="max-w-[54ch]">
        <h2 className="text-ink">One title, kept in two places</h2>
        <p className="lede mt-4 text-[15.5px]">
          The design requires each face to verify the other&apos;s finalized
          state before anything moves. The native record exists today; the WASM
          contract module is not live on the testnet.
        </p>
      </div>

      <FaceDiagram />

      <div className="mt-12 grid gap-10 border-t border-line pt-8 md:grid-cols-2 md:gap-16">
        {FACES.map((face) => (
          <div key={face.name} className="min-w-0">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="text-[17px] text-ink">{face.name}</h3>
              <span className="mono text-[10px] uppercase tracking-[0.1em] text-muted">
                {face.runtime}
              </span>
            </div>
            <p className="mt-3 max-w-[48ch] text-[14px] leading-relaxed text-ink-2">
              {face.body}
            </p>
            <ul className="mt-4 list-none space-y-1.5 p-0">
              {face.items.map((item) => (
                <li
                  key={item}
                  className="flex gap-3 text-[13px] leading-relaxed text-muted"
                >
                  <span aria-hidden="true" className="mt-[9px] h-px w-2.5 shrink-0 bg-line-bright" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
