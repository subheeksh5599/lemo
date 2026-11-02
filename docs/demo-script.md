# LEMO demo script (website only)

Length: 3 minutes 30 seconds. Everything happens in the browser. Do not open a terminal, an editor, or the repository page during the demo.

## Before you start

1. Open **https://lemo-ebon.vercel.app** and let the landing page settle. Do not start anything during the demo.
2. Use one window, at least 1280 pixels wide, browser zoom 100 percent. Close competing tabs.
3. The public endpoints serialize calls. Let each console page settle for two or three seconds before clicking again.
4. Have `deck/lemo-deck.pdf` open in a second window as a fallback. If the site fails completely, show the PDF and say the site is down. Do not claim its numbers are live.

The console reads the chain live. Every head will be higher than the deck. Say that once, early.

## 0:00 to 0:25, the landing page

Stay at the top of the page. Move the cursor near the headline but do not click.

Expect: the headline **“One title. Two runtimes.”**, the navigation with **Open console** on the right, the interactive globe, and the live stats strip below the first screen.

Say: “One native record, one EVM representation, one title. The native room holds the legal record. The EVM room holds the token. A finalized state proof is what lets the token move, and the same title revision has to survive on both sides.”

Point at the announcement bar, then at the live stats strip.

## 0:25 to 0:55, how it works

Click **Protocol** in the top navigation. It scrolls to “How LEMO works”.

Expect: the heading “Bind the title once. Then both runtimes enforce the same conditions, on every transfer.” and the steps Connect / Onboard / Observe / Run.

Say: “The title is bound once: backing, owner, identity, vesting, permissions, revision. The EVM side is an ERC-20 or ERC-721 that Solidity already understands. The token does not replace the native record; it represents an asset governed by it.”

Scroll one screen slowly to the flow diagram.

## 0:55 to 1:20, the live band

Click **Proofs** in the top navigation. It scrolls to the live stat band.

Expect: Finalized head, EVM head, State root, Read at, Native latency. All five are node reads.

Say: “These are live reads, not deck numbers. The finalized head and the EVM head are separate calls. The state root is the one the proof will be checked against.”

Let it sit for two seconds.

## 1:20 to 1:50, the boundary

Click **Security** in the top navigation.

Expect: “A proof can be checked. The gate is live.” and the three boundary tags: trusted root feed, four contracts live, `eth_getProof` refused.

Say: “Four support contracts are deployed: the Blake2b adapter, the trie verifier, the root feed and the ERC-20 gate. The native registry is still a pallet, the WASM contracts module is not live, and the root feed is one attested checkpoint, not a light client. The gate's title commitment is a deployment placeholder, so this is not yet a live asset system.”

Do not scroll past this section. It is the credibility moment.

## 1:50 to 2:20, console overview

Click **Open console** in the top right.

Expect: the Overview page. Five stat cells (finalized head, finality lag, median slot, Revive head, genesis match), then Slot cadence, Recent finalized blocks and Runtimes.

Say: “Every figure is a call this page made. The native endpoint and Revive are read separately. The panel says Revive is live while the native face is not launched.”

Click the refresh icon once. Wait two seconds. The timestamp and heads move forward.

Say: “That is a live read, not a cache.”

## 2:20 to 2:50, proofs

Click **Proofs** in the left sidebar.

Expect: Native witness on the left, Key derivation and EVM account witness on the right.

Say: “The witness is a storage proof for System.Number at the finalized head. Every node is rehashed with blake2b-256, the walk consumes the key nibble by nibble, and the proven bytes must equal state_getStorage at the same block. The verification runs in this browser.”

Point at the verified state and the three check lines. If it says absent or incomplete, read what it says and move on.

Click refresh inside Native witness once. The block number increases.

Say: “New block, new root, new proof.”

Move to EVM account witness. Expect the red **eth_getProof unavailable** and the node’s own `-32601 Method not found`.

Say: “This is the honest failure. Revive does not serve account proofs, so there is no EVM witness. We print the refusal instead of inventing one.”

## 2:50 to 3:10, verify key

Click **Verify key** in the left sidebar.

Expect: Input with a hex storage key and a Trie walk panel.

Click **System.Number key**. Wait for the walk.

Expect: the key fills, the proof is read at the finalized head, and the walk lists nodes with the root-binding result.

Say: “This is the same check with the key exposed. The key is two prefixes concatenated and the proof is read at the finalized block, not at latest. The walk shows every step.”

Point at the root line. Do not type a random key on stage.

## 3:10 to 3:30, network and flow

Click **Network** in the left sidebar.

Expect: Native records, Revive runtime, and Checks with six rows.

Say: “The endpoints, the genesis match, the Revive chain id, and the exact calls this console makes. Genesis matches, chain id matches, the native proof roots, and Revive refuses the account proof as reported.”

Click **Transactions** in the left sidebar.

Expect: the flow page with the three deployed addresses and the native funding panel.

Say: “This is the write surface. The gate is at `0xfbef…741f`, the verifier at `0xe5ca…6bAc`, the feed at `0xc1c9…d5c0`. Mint is wired, but the gate is bound to a deployment placeholder commitment. Without a real native title record and its proof, the transaction must revert. We show that rather than fake a successful mint.”

Stop. Do not click Mint on stage.

## If something goes wrong

- A panel shows red: read the message, say the public endpoint dropped a call, click refresh once, continue.
- “Reading” for more than ten seconds: wait, then refresh. The endpoints serialize calls.
- Site unreachable: switch to `deck/lemo-deck.pdf`, say the live site is down, and walk slides 10 and 2. Do not claim PDF numbers are current.

## Words to avoid on stage

“Audited”, “trustless”, “production ready”, “live asset system”, “live users”, “TVL”, “partnership”. Four support contracts are live on testnet. The native registry is not. The gate’s title commitment is a placeholder. Say that plainly.
