# LEMO: competitive and completeness report

2026-11-02. All URLs accessed 2026-11-02. Read-only review of `/Users/subheeksh/code/lemo`.

**Evidence rule.** A project counts as *shipped* only where a primary source shows deployed code plus docs; audits are named where they exist. `[V]` marks a claim verified against a primary page. Unverified claims are omitted.


## 0. Three facts that reframe the comparison

**0.1 Portaldot V3 is Revive-first; the WASM contract module is not documented as live.** The testnet guide documents `revive` (Solidity, `reviveApi`) and lists the WASM `contracts` module with no launch timing; asked whether ink! and Solidity contracts can call each other, its FAQ answers "awaiting confirmation", and confirms no automatic representation exists between a Revive ERC-20 and a native `assets` asset [5]. Native `assets`, `uniques` and `nfts` do exist, with per-account freeze and approved transfers [4]. So LEMO's "WASM face" has an asset module, no documented contract runtime, and no documented cross-VM call path.

**0.2 The proof machinery already exists in the same hackathon.** BridgeZero, in the same Hacker House (73 builds, code freeze 2026-11-06), ships "Solidity contracts [that] check Portaldot's own finality and storage", reports 149 numbered testnet transactions across four EVM testnets and 6 of 6 attacks reverting, and says "the way back is trusted... a 2-of-3 committee releases your tPOT" [6][7]. AssetDot tokenizes real-world assets with an ink! contract and a document hash [8].

**0.3 LEMO has implemented one third of its README.** What exists is one-sided but real: a Fastify service with a blake2b-256 Substrate trie verifier (`server/src/proofs/trie.ts`) and 1,077 passing tests (`npm test`, 2026-11-02) covering tampered root, tampered child, wrong key, missing node, absence proofs, one proof captured from the live chain, and a 1,019-case stress suite. The EVM side returns the node's own `eth_getProof` refusal [9]. After this report was written, a Foundry contract layer was added (71 tests) for the trie verifier, title commitment and transfer gates. Still no deployment.

> Execution update: the plan below was acted on. `contracts/` now contains the Solidity verifier, title commitment, transfer gates, RootFeed and unbond guard with 83 passing Foundry tests. `docs/EVIDENCE.md` is the current status map. Deployment, the native-side gate and the audit remain open.


## 1. Category comparison

### 1.1 Dual-runtime and cross-VM representation

| Project | Idea | Shipped | Gap closure | Maps to LEMO as |
|---|---|---|---|---|
| Polkadot ERC-20 precompile | Every `pallet-assets` asset gets an ERC-20 address | In the SDK; documented for Polkadot Hub, deterministic addresses, core ERC-20 calls only [1][2] | Aliasing: one balance, two interfaces, no proof | LEMO's EVM face minus the title gate |
| Moonbeam XC-20 | XCM-transferable ERC-20s; "external XC-20s are wrapped representations of tokens whose canonical ledger exists on another parachain" [10] | Live, documented | Sovereign-account custody plus XCM | The wrapped branch LEMO rejects |
| Acala EVM+ | One Substrate account, one bound EVM address | Live; "balances are automatically synchronized between the Substrate account and the associated EVM address" [11] | Address aliasing inside one runtime | Closest shipped "one asset, one owner" claim, balance-level |
| Hydration | Frontier EVM inside the native runtime | Live; EVM and Substrate "settle in the same block, on the same state" [12] | Being one runtime | Strongest objection to LEMO's premise |
| Astar XVM | ink! <-> EVM calls and reads | A long-term effort starting from "a Proof-of-concept version of the Substrate contract module call as an EVM precompiled contract" [13] | Cross-VM precompile | Nearest attempt at LEMO's mechanism; stayed PoC |
| Snowbridge | Polkadot/Ethereum system bridge | In the Polkadot SDK, "trustless, decentralised, no multisigs"; BEEFY client on Ethereum, Beacon client on Polkadot; blinded audits by Oak Security and Codezen [15][16] | Light-client verification | The audit and client bar LEMO must meet |
| Evmos `x/erc20` | Governance-registered Coin/ERC-20 pairs | Live; "trustless, on-chain bidirectional internal conversion"; factory contract for a coin, escrow+mint/burn for an existing ERC-20 [17] | A pair registry the runtime enforces | Closest analogue to LEMO's title registry |
| Aurora | NEP-141/ERC-20 connector | `aurora-eth-connector` implements the token bridge contract [18] | Escrow and burn-mint | Same shape, no identity layer |

Every shipped system closes the gap by aliasing (one ledger, two interfaces) or custody (reserve elsewhere, wrapped here). None runs two ledgers that each verify the other's finalized state. That is LEMO's open corner, open partly because aliasing is cheaper.

### 1.2 Compliant, title-bearing assets

- **Polymesh** enforces compliance in the runtime: a Compliance Manager where issuers set rules over identity claims, trusted issuers, scopes and expiries, checked "automatically during every transfer", OR between rules, AND within one [19]. LEMO's Rule 1 semantics, shipped, with no EVM face.
- **Centrifuge** ships ERC-20 shares with ERC-1404 plus a per-token hook fired on every transfer, mint and burn: memberlists with expiry, per-address freeze, clawback, and action-aware rules that can block bridging per address or destination [20]. The best existing template for a transfer hook.
- **ERC-3643 (T-REX)**, a finalised ERC, already defines LEMO's prose as interfaces: token, Identity Registry, Compliance, Trusted Issuers Registry, Claim Topics Registry [21]. Securitize and Tokeny ship commercial implementations.
- **Ondo OUSG** restricts holding through off-chain onboarding: "only individuals who have onboarded to our Qualified-Access Funds can invest in, redeem, or transfer, or receive OUSG" [22]. The token proves nothing.
- **Provenance** shows the cost of getting authorization wrong: any user could grant themselves admin over marker accounts, affecting "82 markers representing live financial assets on mainnet", fixed in v1.28.0 on 2026-05-01. Trail of Bits' conclusion: "authorization must fail from the default state" [23].
- **tZERO** runs a regulated ATS and transfer-agent stack; compliance is organisational [24].

The vocabulary LEMO needs already has a standard and two reference designs. What does not exist is compliance state on one runtime gating a token on another by proof.

### 1.3 Proof-carrying interoperability

- **IBC** is the model: verify the counterparty's consensus, then prove state. On EVM, `ibc-solidity` implements ICS and ICS-20 and says "still under development and has not been audited" [25]. IBC-on-EVM is research-grade.
- **Hyperlane** generalises the verifier into an Interchain Security Module: the Mailbox calls `verify(metadata, message)`, delivery fails if it reverts or returns false, and the module type tells relayers what metadata to send [26]. That is the interface shape LEMO's gate should expose.
- **Snowbridge** is the production version of the hard route: BEEFY commitments verified on Ethereum with random validator-signature sampling, an interactive three-transaction update drawing randomness from RANDAO, permissionless relayers, and a crypto-economic rather than "trustless" argument [15].
- **Composable Centauri** shipped a GRANDPA light client as an ICS-08 Wasm contract, with live routes Kusama/Cosmos, extended to Polkadot on 2023-06-29 and Ethereum mainnet on 2024-04-03 [28]. **Polymer** positions as an IBC hub for Ethereum rollups [27].

The proof layer is a solved pattern and an unsolved product on EVM. "We verify proofs" is no differentiator.

### 1.4 Wrapped assets with supply and redemption invariants

- **wstETH**: non-rebasable wrapper over stETH; invariant is supply times rate equals stETH held [29].
- **rETH**: minted and burned against ETH with an accruing exchange rate [30].
- **WBTC**: custodial representation, Bitcoin held by BitGo, issued via merchants [31].
- **CCTP**: burn-and-mint across domains, with the trust model in its own docs: "Circle's offchain attestation service signs the message" [32].
- **tBTC** is the closest proof-based unlock: the Bridge validates SPV proofs (`validateProof`, `evaluateProofDifficulty`) and redemptions need an SPV proof submitted on-chain [33]. Bonded wallet signers remain.

Supply invariants are enforced by construction everywhere here. Only tBTC verifies the other ledger cryptographically, one direction, with a client plus signers. LEMO's Rule 2 is the mirror of that, and nobody in this set enforces the mirror.


## 2. Gap analysis against LEMO's acceptance criteria

Status: **None** (no code), **Partial** (off-chain only), **Design** (prose). "Local" asks whether it is finishable with no funds, validator or runtime upgrade.

| # | Criterion | Status | Complete requires | Effort | Local? |
|---|---|---|---|---|---|
| 1 | Title with real native backing | None; nearest primitive is a `pallet-assets` asset [4] | PVM registry contract, or an assets asset plus adapter; backing escrow | L | No |
| 2 | ERC-20/721 representation | None | Token with a verifier hook; Foundry tests; testnet deploy | S | Yes |
| 3 | EVM verifies native finalized proof | Partial (host-side) | Solidity blake2b trie verifier plus an accepted state root | L | Verifier yes, root source no |
| 4 | Native verifies EVM finalized proof | None; node lacks `eth_getProof` | EVM MPT verifier in the native runtime; EVM finality | XL | No |
| 5 | Reject after identity cleared | Design | Identity claims inside the proven key set | M | No |
| 6 | Reject after backing unbound | Design | Backing key in the proof | M | No |
| 7 | Reject stale or replayed proofs | Partial (service: finalized-only, max age, bound fields) | On-chain freshness window plus nullifier per (title, revision, op, root) | S | Yes |
| 8 | Reject unbond while supply outstanding | Design | Native read of EVM `totalSupply`; needs #4 | L | No |
| 9 | Reject unbond while ERC-721 outstanding | Design | Same for ownership records | M | No |
| 10 | Redemption and native unlock | Design | Burn, finalized proof, unlock, replay guard, failure paths | M | No |
| 11 | Interrupted transitions cannot mint unbacked | Design | Two-phase state machine with escrow and explicit resume | M | Yes |
| 12 | Discovery via gossip, not authority | Design; Statement Store availability unverified on V3 [5] | Announcements, or events plus a documented substitution | S | Probably |
| 13 | Full lifecycle on V3 testnet | Not demonstrated | Deployed registry, token, verifier; addresses and transactions published | L | No |

**Hackathon-complete**: contracts deployed on V3 testnet with addresses and transaction hashes, a demo a stranger can run, real data, honest failure states, a README matching the artifacts. No audit, users or native runtime.

**Production-complete**, on the evidence above: external review to Snowbridge's standard of incremental blinded audits [16], a documented adversarial trust model [15][26], an upgrade and incident path, real usage. LEMO is not close, and saying otherwise is the most damaging thing the repo could do.


## 3. Differentiators to claim, claims to drop

**Claim.**
1. **The unit of authorisation is a revisioned title, not a balance.** Nothing surveyed binds backing, owner, identity, vesting, permissions and a revision into one commitment a transfer must re-prove. Polymesh has claims without an EVM face [19]; ERC-3643 has on-chain identity without a native record [21]; the Polkadot precompile has the ERC-20 face only [1].
2. **The invariant runs both ways.** Wrappers enforce deposit-mint and redeem-burn; only tBTC verifies the counterparty ledger, only for its own events [33]. Blocking native unbond while a representation is outstanding is a check none of these perform against a second runtime.
3. **Same chain, no custodian, no vote.** Not a bridge, not a foreign wrapped asset, not an oracle: with a light client as root source, the trust set is the validator set both runtimes already share, narrower than CCTP's attester [32] or WBTC's custodian [31].

**Drop.**
1. **"Neither face can act without cryptographically verifying the other"**, stated as fact. Nothing is deployed, the EVM side has no root source, and the native side has no documented runtime. Use future tense.
2. **"No trusted marketplace server or privileged relayer."** The proof service is exactly that, and any root feed buildable today is a relayer or a pinned checkpoint. Name it and state what it can lie about.
3. **"Portaldot runs two contract environments"**, present tense. `contracts` is not launched on the testnet and cross-VM calls are unconfirmed [5]. Say "ships Revive today and lists the WASM module for V3.0".


## 4. Execution plan (10 items, finite)

1. **Freeze the claims.** Rewrite the status table and every present-tense guarantee; add `docs/EVIDENCE.md` mapping all 13 criteria to artifact, command, output. *Evidence:* 13 rows, none claiming implementation without a file and test name.
2. **Canonical title encoding with shared vectors.** One struct, one domain-separated hash, one revision rule, one JSON vector file consumed by TypeScript and Solidity tests. *Evidence:* identical hashes in both suites; a revision bump invalidates the old vector.
3. **Solidity Substrate trie verifier.** Port node hashing and SCALE decoding, validate against the live-captured proof already in the server fixtures plus the existing tamper cases. *Evidence:* Foundry passes the real proof, reverts on flipped root, flipped child, wrong key, truncation and false absence, and returns the same value as the TypeScript verifier.
4. **`TitleGate` token hooks.** ERC-20 and ERC-721 variants calling the verifier before any transfer, nullifier per (title, revision, op, root). *Evidence:* six negative tests (stale root, old revision, unbound backing, cleared identity, wrong contract, replay) revert with distinct selectors; one transfer succeeds.
5. **Name the root source in code.** A `RootFeed` with pinned-checkpoint or on-chain-justification mode, plus `docs/TRUST.md`. *Evidence:* mode is a constructor parameter; TRUST.md ties each assumption to its enforcing line.
6. **Rule 2 in a PVM contract, tested locally.** Build the unbond guard in ink!, run on a local contract node, label it "local node, not V3 testnet". *Evidence:* logs show unbond reverting with representation outstanding, succeeding at zero supply.
7. **Failure-injection harness.** Twelve scenarios: mint without backing, burn without proof, proof double-spend, root reorg, interruption between burn and unlock. *Evidence:* one command, twelve named results, all failing closed.
8. **Testnet deployment with artifacts.** Deploy verifier, feed and token to the V3 EVM endpoint; record addresses, deployment hashes, one gated transfer each way. *Evidence:* `deployments/v3-testnet.json` plus explorer links, read by the console.
9. **Console honesty pass.** Show deployed artifacts, the verifier's verdict on a real transfer, and the node's `eth_getProof` refusal verbatim. *Evidence:* three captured states (verified, refused, unavailable) and the RPC calls listed.
10. **Discovery without authority.** Test Statement Store; if absent, publish announcements as events and document the substitution. *Evidence:* an announcement published and re-read, with the authorisation path shown to ignore it.

**Out of scope, stated as such:** external audit, native-side EVM verification (#4), full testnet lifecycle (#13), any usage claim. Production gaps, not polish.


## Sources

1. https://docs.polkadot.com/smart-contracts/precompiles/erc20/ [V]
2. polkadot-sdk, `pallet-assets-precompiles`. https://paritytech.github.io/polkadot-sdk/master/src/pallet_assets_precompiles/lib.rs.html [V]
3. https://forum.polkadot.network/t/revive-smart-contracts-status-update/16366 [V]
4. https://raw.githubusercontent.com/ItsCogumellum/portaldot-v3-testnet-guide/main/README.md [V]
5. https://raw.githubusercontent.com/ItsCogumellum/portaldot-v3-testnet-guide/main/FAQ.md [V]
6. DoraHacks, Portaldot Hacker house 2026. https://dorahacks.io/hackathon/portaldot-hacker-house-2026/detail [V]
7. https://dorahacks.io/buidl/50245 [V]
8. https://dorahacks.io/buidl/43865 [V]
9. LEMO repo: `README.md`, `server/src/proofs/trie.ts`, `server/src/service.ts`; `npm test` run 2026-11-02 [V]
10. https://raw.githubusercontent.com/moonbeam-foundation/moonbeam-docs/master/builders/interoperability/xcm/xc20/overview.md [V]
11. https://wiki.acala.network/build/development-guide/smart-contracts/get-started-evm/evm-account [V]
12. https://docs.hydration.net/devs/evm [V]
13. https://docs.astar.network/learn/core-features/x-vm-cross-virtual-machine [V]
14. https://docs.snowbridge.network/ [V]
15. https://docs.snowbridge.network/architecture/verification/polkadot [V]
16. https://docs.snowbridge.network/security/audits [V]
17. https://docs.evmos.org/protocol/modules/erc20 [V]
18. Aurora Eth Connector. https://github.com/Near-One/aurora-eth-connector [V]
19. Polymesh, Compliance. https://developers.polymesh.network/compliance/ [V]
20. https://docs.centrifuge.io/developer/protocol/features/token-compliance/ [V]
21. https://eips.ethereum.org/EIPS/eip-3643 [V]
22. https://docs.ondo.finance/qualified-access-products/ousg/eligibility-and-onboarding [V]
23. https://blog.trailofbits.com/2026/08/25/state-divergence-enables-unauthorized-access/ [V]
24. https://www.tzero.com/ [V]
25. https://raw.githubusercontent.com/hyperledger-labs/yui-ibc-solidity/main/README.md [V]
26. https://docs.hyperlane.xyz/docs/protocol/ISM/custom-ISM [V]
27. Polymer whitepaper. https://polymerlabs.org/polymer-whitepaper-pdf [V]
28. https://composable.finance/centauri/ [V]
29. https://raw.githubusercontent.com/lidofinance/docs/main/docs/guides/lido-tokens-integration-guide.md [V]
30. https://docs.rocketpool.net/protocol/faq [V]
31. https://wbtc.network/ [V]
32. https://developers.circle.com/cctp/v1/generic-message-passing [V]
33. https://docs.threshold.network/app-development/tbtc-contracts-api/tbtc-v2-api/bitcointx [V]

**Coverage limits.** DoraHacks was reachable only through a reader proxy; 6 of 73 builds were profiled, so the field read is a sample. Rocket Pool's audit PDFs returned 403. Portaldot's revive precompile set and any state-root access path are not publicly documented, so the root-source question stays open.
