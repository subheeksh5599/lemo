# LEMO deck notes

Files: `deck/index.html` (self contained, opens from `file://`), `deck/lemo-deck.pdf` (12 pages, 16:9), `deck/live-facts.json` (the captured figures used on slides 1 and 10).

Navigation: right arrow, down arrow, space, page down for next. Left arrow, up arrow, page up for previous. Home and End jump to the first and last slide. Clicking the right side of a slide advances, clicking the left 18 percent goes back. Each slide has a clean hash: `#cover`, `#gap`, `#consequence`, `#title`, `#architecture`, `#rule-1`, `#rule-2`, `#lifecycle`, `#hard-problems`, `#live`, `#why-portaldot`, `#ask`.

Run time: 8 to 9 minutes for all twelve slides. Times below are a guide, not a script to read.

## Ground truth for this deck

- No registry, title, token or verifier is deployed on Portaldot V3. The deck says so on slides 4, 8, 10 and 12.
- Revive (EVM) is live on Portaldot V3 today. The WASM contracts module is listed for V3.0 and is not live or documented. ink! to Solidity cross calls are awaiting confirmation.
- Native assets, identity, vesting and proxy or multisig records already exist in the native runtime.
- The console reads the native node and Revive over public JSON-RPC. The native trie witness is verified in the browser. The proof service is in the repository: a Fastify API, a trie verifier and typed RPC clients, tested against captured fixtures. It is not deployed.
- The testnet EVM endpoint answers `eth_getProof` with `-32601 Method not found`. That refusal is shown, never hidden.
- Root source today is a trusted finalized checkpoint. The witness is bound to the state root the node reports, and the root itself is not proven by a light client yet.
- Figures on slides 1 and 10 were captured on 2026-11-02 at 14:20 UTC: best head 292,823, finalized head 292,820, finality lag 3 blocks, Revive head 292,823, chain id 420420777, genesis matched. Heads advance with every slot, so the live console will show higher numbers during the demo. Say that out loud instead of pretending the deck is live.

## Slide notes

### 1. Cover (40 seconds)

Say: "Portaldot V3 has Revive live today. Its WASM contracts module is listed for V3.0, not deployed. LEMO is the design that turns those two halves into one asset with one revisioned title. The invariant is bidirectional: each face must verify the other before it moves. The card on the right is not a mock. It is the two public endpoints answering at 14:20 UTC."

Point at: the live card, then the three columns under the headline.

Do not say: "two live runtimes", "deployed", or "audited".

### 2. The gap (45 seconds)

Say: "Revive is live. The WASM contracts module is only listed. That matters because the native runtime already keeps the records LEMO needs: assets, identity, vesting, proxy and multisig ownership. What is missing is a contract module that can enforce title logic on that side. When it lands, both environments share validators and finality but not contract storage. A proof has to cross because a call cannot."

If asked why build now: the EVM verifier does not depend on the module. The native verifier does. Building the first now is the whole point of the ask.

### 3. The consequence (40 seconds)

Say: "Without a proof that crosses, four things break. Ownership rules stop at the boundary. Solidity sees a token, not the identity or vesting behind it. Backing can leave while a representation still circulates. And the fallback is a sync service that becomes the authority. Wrapping moves the asset. It does not enforce the relationship."

### 4. The idea (50 seconds)

Say: "One title identifier, two faces. The WASM face is the legal record: backing, owner, identity, vesting, permissions, revision. The EVM face is the market representation: ERC-20 or ERC-721, supply, holder, accepted revision. The title hash names the relationship. It is a commitment, not a proof, so each verifier has to check the underlying state. These values are a specimen. No title is deployed."

Point at: revision 07 appearing on both faces.

### 5. Architecture (60 seconds)

Say: "Two proofs and two gates. Top row: a transfer on EVM verifies a finalized native proof before it settles. Bottom row: native unbond verifies a finalized EVM proof showing supply is zero or every token is retired. Arrows carry proof bytes, not calls. The EVM gate is buildable today. The native gate needs the WASM module. Statement Store is a noticeboard for discovery. It never authorizes anything."

If asked about cross calls: the design does not need them, which is useful because ink! to Solidity calls are still awaiting confirmation.

### 6. Rule one (45 seconds)

Say: "Rule one: an EVM transfer needs a finalized, current native proof. Five things must be true in the same proof: the title exists at the proven root, backing is bound, identity holds, vesting permits the movement, and the revision is current. All five pass and the transfer settles. Any one fails and it reverts with supply untouched. This is the design rule, not a deployed check. The verifier is buildable now. Its native input waits on the module."

### 7. Rule two (45 seconds)

Say: "Rule two is the other direction. Burn first, unlock second. The representation is burned, the burn finalizes, the WASM side verifies the EVM retirement proof, and only then does backing release. If any balance or representation is outstanding, unbond reverts. Step three needs the WASM module, which is listed for V3.0."

If asked about the relayer: a relayer can carry bytes. It cannot make a bad proof verify. The receiving runtime does the checking.

### 8. Lifecycle (45 seconds)

Say: "Five steps. Create writes the title and locks backing. Represent issues the token only after a proven native backing. Transfer rechecks the title on every move. Update changes identity, backing or ownership, increments the revision and kills every older proof. Redeem burns first and unlocks last. Revision binding is the part that makes the rest safe: valid bytes from revision 06 are the wrong answer at 07. None of this has run end to end on V3 yet."

### 9. The hard part (55 seconds)

Say: "The token contract is the easy part. Five problems decide whether this is real: finality, freshness, revision binding, replay protection, interrupted transitions. Each one is a requirement. Two honest constraints: the testnet EVM endpoint does not implement account proofs, so the EVM witness path needs another source before rule one can be enforced. And the root source today is a trusted finalized checkpoint. Removing that trust is part of the work, not a detail to hide."

### 10. What is live today (50 seconds)

Say: "What runs today is a reading surface, a client side witness, a Solidity verifier with 83 Foundry tests, and a proof service with 1,077 tests. The console reads the native node and Revive over plain JSON-RPC. It shows finalized head 292,820 and lag 3 at 14:20 UTC. The witness pulls a storage proof for System.Number at the finalized head, rehashes every trie node with blake2b-256, and checks it against the root the chain published. The status table is the honest one: the WASM runtime is not launched, the gates are tested but not deployed, end to end is not demonstrated, and there is no audit. The EVM endpoint refuses eth_getProof and the console prints the refusal."

Point at: the red `eth_getProof unavailable` badge, then the `Not performed` audit row.

### 11. Why Portaldot (45 seconds)

Say: "This model needs both runtimes, and Portaldot has one live and one listed. Today an asset can have an EVM market but no contract level native record to prove. Elsewhere a native contract has no EVM market. With both, one finality lets a proof cross. The design invariant is that neither face may move without proving the other. It is not enforced end to end yet, and the deck says so under the quote."

### 12. The ask (40 seconds)

Say: "The ask is specific. Confirm the module and Statement Store timelines. Build the EVM gate against a real title registry. Add the native gate when the module ships. Then break it on purpose: cleared identity, unbound backing, stale or replayed proof, outstanding supply. No registry, no token, no audit, no invented traction. Judge the design and the live reads."

## Claims we do not make

- No users, TVL, volume, partners, audits, or revenue. None exist.
- No deployed registry, title, token or verifier.
- No "two live runtimes". Revive is live. The WASM contracts module is listed.
- No claim that the bidirectional check is enforced today. It is the design invariant.
- No claim that gossip is authoritative.
- No claim that the proof service is deployed or serving public HTTP. It runs locally from the repository.
- No claim that a root is trustless today. It is a trusted finalized checkpoint.

## Likely questions

**Is this a bridge?** No. A bridge moves value between chains and usually locks on one side. This is one chain, two execution models, one title, and a proof gate in each direction. No custody, no wrapped pool, no relayer deciding validity.

**Why not just deploy an ERC-20?** Because the legal record is identity, vesting, permissions and native ownership. A plain ERC-20 cannot enforce any of that. LEMO makes the token subordinate to a title.

**What is actually running?** The console and the browser witness. The verifier code and fixtures. No deployment.

**How do you verify native state from EVM if the module is not live?** You cannot yet. The EVM verifier is buildable and testable against fixtures. Production enforcement needs the module and a native proof source.

**What about eth_getProof?** The endpoint returns -32601. The console shows that. An EVM witness needs a different source, and that is open work.

**What stops a reorg?** Finality plus binding the proof to a finalized block and a revision. That is rule one, and it is why the finalized head is on the slide.

**Who is the team?** Do not invent names. Point at the repository and the live console, and say the work is public.
