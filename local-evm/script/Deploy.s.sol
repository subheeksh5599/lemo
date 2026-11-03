// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";
import { TitleLib, TitleRecord } from "lemo/LemoTitle.sol";
import { ITitleVerifier } from "lemo/ITitleVerifier.sol";
import { IRootFeed } from "lemo/IRootFeed.sol";
import { SubstrateTrieVerifier } from "lemo/SubstrateTrieVerifier.sol";
import { RootFeed } from "lemo/RootFeed.sol";
import { TitleGateERC20 } from "lemo/TitleGateERC20.sol";
import { TestBlake2b } from "harness/TestBlake2b.sol";
import { FixtureHarness } from "../src/FixtureHarness.sol";
import { TitleProofBuilder } from "harness/TitleProofBuilder.sol";

/// @dev Local-only nonce bump so the script deploys the gate at the same
/// deterministic address as the Foundry fixture test (which deploys a proof
/// builder between the verifier and the feed).
contract NonceBump {}

/// @title Deploy
/// @notice Deploys the repository's real gate stack to a local Anvil chain and
/// attests the fixture's finalized state root. The commitment is derived by
/// decoding the fixture's canonical 320 byte value through TitleLib, never by
/// trusting the JSON `record` block.
contract Deploy is Script {
  function run() external returns (TitleGateERC20 gate, FixtureHarness harness) {
    string memory json = vm.readFile("../fixtures/lemo-local-capture.json");
    bytes memory canonicalValue = vm.parseJsonBytes(json, ".canonicalValue");
    bytes memory canonicalKey = vm.parseJsonBytes(json, ".canonicalStorageKey");
    bytes[] memory nodes = vm.parseJsonBytesArray(json, ".canonicalProofNodes");
    bytes32 stateRoot = vm.parseJsonBytes32(json, ".finalized.stateRoot");
    uint256 blockNumber = vm.parseJsonUint(json, ".finalized.number");

    require(canonicalValue.length == 320, "fixture canonical value is not 320 bytes");
    (bool ok, TitleRecord memory record) = TitleLib.decodeNative(canonicalValue);
    require(ok, "fixture canonical value does not decode");
    bytes32 commitment = TitleLib.hash(record);

    vm.startBroadcast();
    TestBlake2b hasher = new TestBlake2b();
    SubstrateTrieVerifier verifier = new SubstrateTrieVerifier(hasher);
    new NonceBump();
    new TitleProofBuilder(hasher);
    RootFeed feed = new RootFeed(msg.sender);
    gate = new TitleGateERC20(
      ITitleVerifier(address(verifier)),
      IRootFeed(address(feed)),
      record.titleId,
      commitment,
      msg.sender,
      "LEMO Local Title",
      "LEMO-L",
      1_000_000e18
    );
    harness = new FixtureHarness(
      verifier, canonicalValue, stateRoot, canonicalKey, nodes
    );
    feed.attest(stateRoot, blockNumber);
    vm.stopBroadcast();

    vm.serializeUint("deploy", "chainId", block.chainid);
    vm.serializeAddress("deploy", "deployer", msg.sender);
    vm.serializeAddress("deploy", "hasher", address(hasher));
    vm.serializeAddress("deploy", "verifier", address(verifier));
    vm.serializeAddress("deploy", "feed", address(feed));
    vm.serializeAddress("deploy", "gate", address(gate));
    vm.serializeAddress("deploy", "harness", address(harness));
    vm.serializeAddress("deploy", "recordOwner", record.owner);
    vm.serializeBytes32("deploy", "titleId", record.titleId);
    vm.serializeBytes32("deploy", "titleCommitment", commitment);
    vm.serializeBytes32("deploy", "fixtureStateRoot", stateRoot);
    vm.serializeUint("deploy", "fixtureBlockNumber", blockNumber);
    vm.serializeUint("deploy", "canonicalValueBytes", canonicalValue.length);
    vm.serializeUint("deploy", "canonicalKeyBytes", canonicalKey.length);
    vm.serializeUint("deploy", "revision", record.revision);
    string memory out = vm.serializeString("deploy", "labelled", "LOCAL ANVIL ONLY - NOT PORTALDOT");
    vm.writeJson(out, "./results/deployments.json");
  }
}
