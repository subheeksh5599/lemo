# LEMO demo script (website only)

Length: 4 minutes. Everything below happens in the browser. Do not open a terminal, an editor, or the repository page during the demo.

## Before you start

1. The site is already running and open at `http://localhost:3000` (or the deployed URL). Do not start anything during the demo.
2. Use one window, 1440 pixels wide or wider, browser zoom at 100 percent. Close other tabs so the console reads are not competing for the connection.
3. The public endpoints drop connections when several calls land at once, so let each page settle for two or three seconds before clicking again.
4. Have `deck/lemo-deck.pdf` open in a second window as a fallback. If the site fails completely, switch to the PDF and say the site is down, without pretending it is not.

The console reads the chain live, so every number will be higher than the deck. Say that once, early, and then read what is on screen.

## 0:00 to 0:20, landing page

Do: stay at the top of the home page. Move the cursor near the headline but do not click.

Expect: the headline "One asset, two runtimes, one title", the specimen register on the right, and the live strip below the first screen.

Say: "This is the public design. One asset, one revisioned title, and a bidirectional proof gate between Portaldot's native runtime and Revive. The register on the right is a specimen, and it is labeled as one. Nothing is deployed."
Do: point at the specimen label, then at the live strip.

## 0:20 to 0:50, the protocol section

Do: click the button "Read the protocol" under the headline.

Expect: the page scrolls to the protocol section with the two faces and the title identifier.

Say: "The native side is the legal record: backing, owner, identity, vesting, permissions, revision. The EVM side is the market representation: an ERC-20 or ERC-721 that Solidity already understands. They are tied by one title id and one revision. The native record exists today; the WASM contract module is still listed for V3.0."

Do: scroll down one screen slowly, stopping at the diagram.

## 0:50 to 1:20, rules

Do: click "Rules" in the top navigation.

Expect: the two rules, each with the allow and revert conditions.

Say: "Rule one: an EVM transfer verifies a finalized native proof before it settles. Rule two: native unbond verifies that the EVM representation is fully retired. Both are design rules. The EVM gate is buildable now. The native gate waits on the WASM contracts module, which is listed for V3.0."

Do: point at the "revert" line in each rule, then move on. Do not read every bullet.

## 1:20 to 1:40, lifecycle

Do: click "Lifecycle" in the top navigation.

Expect: five steps and the revision line.

Say: "Create, represent, transfer, update, redeem. The revision is the safety rail. Change identity, backing or ownership and the revision increments, so every older proof stops being current. Valid bytes from revision 06 are the wrong answer at 07."

## 1:40 to 2:00, status

Do: click "Status" in the top navigation.

Expect: the honest status table, including design, implementation required, not demonstrated, and no audit.

Say: "This table is the one to judge us on. The WASM contract runtime is not launched. The native registry is still implementation required. The ERC-20 and ERC-721 gates are tested but not deployed. Native-to-EVM proof verification is tested in TypeScript and Solidity. EVM-to-native is blocked by the WASM module. End to end is not demonstrated, and there is no audit. The console below is real, and it only reads."

Do: do not scroll past this section. It is the credibility moment.

## 2:00 to 2:30, console overview

Do: click "Open console" in the top right of the navigation.

Expect: the Overview page. Five stat cells at the top (finalized head, finality lag, median slot, Revive head, genesis match), then "Slot cadence", "Recent finalized blocks" and the "Runtimes" panel.

Say: "Finalized head, finality lag, median slot, and the Revive head. Each figure is a call this page made. The cadence chart is built from finalized blocks. The native endpoint and Revive are read separately, and the panel says the Revive side is live while the native face is not launched."

Do: point at "Finalized head" and "Finality lag". Then point at the "Runtimes" panel hint.

Do: click the refresh icon at the top right of the console once. Wait two seconds.

Expect: the timestamp next to the live indicator updates, and the heads move forward.

Say: "That is a live read, not a cached number."

## 2:30 to 3:15, proofs

Do: click "Proofs" in the left sidebar.

Expect: the "Native witness" panel on the left, "Key derivation" and "EVM account witness" on the right.

Say: "The witness is a storage proof for System.Number at the finalized head. Every node is rehashed with blake2b-256, the walk consumes the key nibble by nibble, and the proven bytes must equal state_getStorage at the same block. The verification runs in this browser. The node is not trusted to tell the truth about the value."

Do: point at the green "verified" state, then at the three check lines under it. If the panel says "absent" or "incomplete", say what it says and move on. Do not explain it away.

Do: click the refresh icon inside the Native witness panel once.

Expect: the proof re-reads at a newer finalized head and the block number increases.

Say: "New block, new root, new proof."

Do: move to the "EVM account witness" card on the right.

Expect: the red badge "eth_getProof unavailable" and the node's own message, `-32601 Method not found`.

Say: "This is the honest failure. The Revive endpoint does not implement account proofs, so there is no EVM witness to show. We print the node's refusal instead of inventing one. That is the open problem on the EVM side of rule two."

Do: do not click "Ask the endpoint again" more than once. The answer will not change.

## 3:15 to 3:45, verify key

Do: click "Verify key" in the left sidebar.

Expect: an "Input" panel with a hex storage key field and a "Trie walk" panel.

Do: click the button "System.Number key". Wait for the walk to finish.

Expect: the input fills with the 32 byte key, the proof is read at the finalized head, and the trie walk lists the nodes with the root binding result.

Say: "This is the same check with the key exposed. The key is two prefixes concatenated, read at the finalized block hash rather than at latest. The walk shows each step: rehash, root, walk, compare. If any step fails, the panel says so."

Do: scroll inside the page to the "Trie walk" panel and point at the root line. Do not type a random key on stage.

## 3:45 to 4:00, network

Do: click "Network" in the left sidebar.

Expect: "Native records", "Revive runtime", and a "Checks" panel with six rows.

Say: "One last page: the endpoints, the genesis match, the Revive chain id, and the exact calls this console makes. Genesis matches, chain id matches, a native proof roots, and Revive refuses the account proof as reported. Every check here is a call this page made."

Do: stop. Do not scroll further.

## If something goes wrong

- A panel shows a red error: read the message out loud, say the public endpoint dropped a call, click refresh once, and continue. Do not reload the whole page unless two panels fail.
- The console shows "reading" for more than ten seconds: wait, then click refresh. The endpoints serialize calls.
- The site is unreachable: switch to `deck/lemo-deck.pdf`, say the live site is down, and walk slides 10 and 2 instead. Do not claim live numbers from the PDF are current.
- Someone asks for the repository: say it is public and will be shared after the run. Do not open it on screen during the demo.

## Words to avoid on stage

"Deployed", "audited", "live users", "TVL", "partnership", "trustless", "production ready", "two live runtimes". Revive is live. The WASM contracts module is listed. The rest is design.
