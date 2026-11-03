# LEMO demo script (website only)

About 3 minutes. Everything happens in the browser: no terminal, no editor, no repository page. One window, at least 1280 px wide, zoom 100 percent. Start on the landing page with the page settled. The public endpoints serialize calls, so let each live page settle for two seconds before the next click.

The console reads Portaldot V3 testnet live, so heads will differ from any earlier recording. The local lifecycle page is a recorded run on a local devnet and anvil. Say which one you are on every time you change between them.

## 0:00 to 0:20, landing

**Click:** nothing. Hold on the hero for three seconds, cursor away from the text.

**Expect:** "One title. Two runtimes." over the globe, **Open console** top right.

**Say:** "One native record and one EVM token, held to the same title. The token can only move with a finalized state proof of the native record, and the native backing can only be released once the token is gone."

## 0:20 to 0:45, console overview

**Click:** **Open console**.

**Expect:** Overview: finalized head, finality lag, median slot, Revive head, genesis; then Slot cadence, Recent finalized blocks, Runtimes.

**Say:** "These are live reads of Portaldot V3 testnet, made by this page. The native and Revive columns are separate calls."

**Click:** the refresh icon in the top bar once. Wait two seconds.

**Say:** "The heads move. This is not a cache."

**Point at:** the **Root source** row in the Runtimes table.

**Say:** "This row names where the gate's state root comes from. Today that is a trusted single attester, and the page says so."

## 0:45 to 1:05, proofs

**Click:** **Proofs** in the sidebar.

**Expect:** Native witness with its check lines; EVM account witness in red with `-32601 Method not found`.

**Say:** "A storage proof at the finalized head, with every node rehashed in this browser. On the right, Revive refuses eth_getProof, and we print the refusal instead of inventing a witness."

## 1:05 to 1:20, verify key

**Click:** **Verify key** in the sidebar, then **System.Number key**. Wait for the walk.

**Say:** "The same check with the key exposed: two twox128 prefixes, read at the finalized block and walked to the root."

## 1:20 to 2:40, local lifecycle

**Click:** **Local lifecycle** in the sidebar.

**Expect:** the notice "A local devnet run, recorded once", then the figure band. **Browser checks** reads **9/9**.

**Say:** "This page is a recording from a local devnet, and it says so at the top. The native half is our runtime with the title pallet, which has no EVM. The EVM half is anvil. Every hash here is a real transaction on those two chains, and the proofs and GRANDPA signatures are checked again right now, in this browser."

**Click:** **Re-verify in browser**. The milliseconds in the figure note and the footer time change.

**Scroll to 01, Create the title on the native chain.**

**Say:** "Alice creates a title. The pallet derives the id from her account and a salt, and reserves a deposit. She binds the title to the gate address, and the flag is set to live."

**Scroll to 02, Wait for finality and capture the proof.**

**Point at:** the three check lines, then the open proof path.

**Say:** "Block seven is finalized. Its header bytes hash to the block hash and carry this state root. The GRANDPA precommit is an ed25519 signature by the dev authority, verified here. The trie walk reaches the 320-byte record at revision two, and the record names the gate."

**Scroll to 03, Mint and transfer on anvil.**

**Say:** "On anvil, the feed attests that root. The gate mints the full cap to the beneficiary the record names, and the transfer carries its own proof. Sending the same transfer again reverts with ProofReplayed."

**Scroll to 04, Unbond refused while the representation is live.** Hold on the red step.

**Say:** "This is the step that matters. With tokens still outstanding, Alice asks the native chain to release the backing. The request is included in block ten and refused with lemoTitle.RepresentationLive. The EVM guard refuses too, with RepresentationOutstanding."

**Scroll to 05, Burn the representation with a fresh finalized root.**

**Say:** "A later finalized block becomes the root, verified the same way. Bob sends his share back and the whole cap is burned. Supply is zero, and outstanding is false."

**Scroll to 06, Unbond allowed on the native chain.**

**Say:** "Only after the burn is the flag set to not live. Now the unbond request succeeds. Finalizing early is refused with UnbondingNotDue. After ten blocks, Bob finalizes it. The record is deleted, the deposit is returned, and the last proof shows the key is absent from a finalized root."

## 2:40 to 3:00, transactions (live gate)

**Click:** **Transactions** in the sidebar.

**Expect:** the flow page with the deployed gate, verifier and feed, and a warning notice about the gate's state.

**Say:** "This is the live gate on Portaldot testnet. Its notice says exactly what it can and cannot do today. The local run shows the full lifecycle. This page is where that lifecycle lands in public."

**Do not click Mint.**

> Placeholder: a page for the validator-signed root feed will go here (another agent is building the feed). Once it exists, click it after Transactions and say one line: "Here the root is signed by the validator set, not by one attester." Until then, skip this beat.

## If something goes wrong

- A live panel shows red: read the message, click refresh once, then continue. The local lifecycle page does not depend on any endpoint.
- **Browser checks** on the local page shows anything other than 9/9: say so, scroll to the red check line and read it out. Do not explain it away.
- Site unreachable: switch to `deck/lemo-deck.pdf` and say the live site is down. Do not claim the PDF numbers are current.

## Words to avoid on stage

"Audited", "trustless", "production ready", "mainnet", "live users", "TVL", "partnership". The local run is a local devnet and anvil. The public gate is on testnet with a single-attester root feed. Say that plainly.
