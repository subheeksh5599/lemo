# LEMO demo script (website only)

About 6 minutes. Everything happens in the browser: no terminal, no editor, no repository page. One window, at least 1280 px wide, zoom 100 percent. Start on the landing page with the page settled. The public endpoints serialize calls, so let each live page settle for two seconds before the next click.

**Before recording:** install a Portaldot wallet extension (Talisman, SubWallet or Polkadot.js), import the project wallet `5FJ9…kshCz` (it holds about 64 tPOT; a mint holds about 27 tPOT of deposit, everything else costs under 1 tPOT), and allow it on the site once so the approval prompt does not surprise you on camera. Only Transact and the "Sign the update yourself" panel on Verify use the wallet.

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

**Say:** "This row names where the original gate's state root comes from: a single attester, and the page says so. The token you'll see on Transact reads the validator-signed feed instead."

## 0:45 to 2:00, local lifecycle

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

## 2:00 to 4:30, the same rules on the public chain: Transact

Say first: "That was the local runtime. Now public Portaldot V3, signed by my own wallet."

**Click:** **Transact** in the sidebar, **Connect wallet**, pick `5FJ9…kshCz`. **Expect:** your native balance and your EVM address.

**Click:** **Create native title**, approve. **Expect:** "Native title created", extrinsic `319,xxx-1`, **open on the scanner**. **Say:** "A real item in Portaldot's native NFT pallet, owned by me."

Wait about 30 seconds (BEEFY signs a few blocks behind). **Click:** **Prove and mint 1,000 LNT**, approve. **Expect:** "Minted against the native proof", Your LNT 1,000. **Say:** "The token contract walked a proof of my native item under the root the validators signed, and minted only to the address my native account maps to."

**Click:** paste any SS58 address as recipient, **Transfer**, approve. **Expect:** Transferred, Your LNT 600.

**Click:** **Burn native title**, approve; wait 30 seconds; **Prove it and freeze**, approve. **Expect:** Token for this title: frozen. **Click:** **Transfer** again. **Expect:** "the contract would revert: TitleFrozen", then **Send anyway: record the refusal on-chain** gives "refused on-chain: revive.ContractReverted" with its own scanner link. **Say:** "The native title is gone, so the EVM token stops. The EVM side obeys the native side, on the public chain."

Open one of the scanner links on camera. This section runs about 2½ minutes with the waits; it is the one to keep if you cut anything.

## 4:30 to 5:00, validator-signed roots

**Click:** **Verify** in the sidebar, then **the BEEFY detail page** link in the first notice. Wait until the verdict reads PASS.

**Expect:** Verdict PASS, Signers 2 / 2, four steps (validator signatures, MMR root, header, state root) all PASS, and the On-chain feed panel with `currentRoot = browser-derived root` reading **match**.

**Say:** "This is where the root comes from now. Both Portaldot validators signed this block's MMR root; the page recovers their keys, rebuilds the root from on-chain peaks and hashes the header to get the state root. The feed contract on Portaldot does the same checks and has no owner and no attester. Its current root matches."

**Click:** **Flip a signature byte**.

**Expect:** Verdict FAIL, Signers 1 / 2.

**Say:** "One flipped byte and the signature no longer recovers to a validator. The contract reverts the same way."

**Click:** **Off** to restore. Optionally click **account** on the feed panel to open it on the Portaldot scanner.

## 5:00 to 5:30, prove native state in the EVM

**Click:** **Verify** in the sidebar, then **Prove on-chain**.

**Expect:** Verifier verdict PROVEN, the proven free balance equal to "Node says", Proven bytes = storage: match.

**Say:** "This is Rule 1's read path, live on public Portaldot. The verifier contract takes the validator-signed root from the feed and a native storage proof, and decides by itself that this account's native record is real. Any address works."

**Click:** tick **flip one proof byte**, **Prove on-chain**.

**Expect:** INCOMPLETE. **Say:** "One byte changed and the contract refuses it."

## 5:30 to 6:00, sign the feed update yourself

**Click:** untick it. Under **Sign the update yourself**, pick the wallet, **Connect wallet**, choose `5FJ9…kshCz`, **Sign and submit**, approve in the extension.

**Expect:** the button walks Planning from BEEFY, Dry-running against the feed, Approve in your wallet, Broadcast. Then an Extrinsic row such as `318,9xx-1` with **open on the scanner**.

**Say:** "I'm signing this myself. The page took the validators' signatures for every set the feed is behind, and my wallet sends them to the feed in one extrinsic. If they didn't sign it, the feed reverts."

**Click:** **open on the scanner**. **Expect:** the Portaldot V3 scanner showing `utility.batchAll`, Signer `5FJ9…kshCz`, calls to `0x0ec209…6937`. **Say:** "Here it is on the Portaldot explorer, signed by my account." Back on the site, **Root of block** in step 1 has moved forward.

If the result says the feed would refuse it, someone advanced it a moment ago: wait a minute and press again. **Advance the feed now** does the same through the server relayer if the wallet misbehaves.

## If something goes wrong

- A live panel shows red: read the message, click refresh once, then continue. The local lifecycle page does not depend on any endpoint.
- **Browser checks** on the local page shows anything other than 9/9: say so, scroll to the red check line and read it out. Do not explain it away.
- Site unreachable: switch to `deck/lemo-deck.pdf` and say the live site is down. Do not claim the PDF numbers are current.

## Words to avoid on stage

"Audited", "trustless", "production ready", "mainnet", "live users", "TVL", "partnership". The local run is a local devnet and anvil. The validator-signed feed is live on testnet, but the paused public gate still reads the older single-attester feed. Say that plainly.
