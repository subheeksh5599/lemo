// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { IBlake2b256 } from "lemo/IBlake2b256.sol";
import { ReviveBlake2b256 } from "lemo/ReviveBlake2b256.sol";
import { SubstrateTrieVerifier } from "lemo/SubstrateTrieVerifier.sol";
import { RootFeed } from "lemo/RootFeed.sol";
import { ThresholdRootFeed } from "lemo/ThresholdRootFeed.sol";
import { IRootFeed } from "lemo/IRootFeed.sol";
import { TitleRecord, TitleLib } from "lemo/LemoTitle.sol";
import { TitleGateERC20 } from "lemo/TitleGateERC20.sol";

/// @title Deploy
/// @notice The deployment sequence for one gated ERC-20 representation of one
/// title, in the order the contracts depend on each other.
///
/// Environment:
///   DEPLOY_CONFIRM      must be exactly "yes". Anything else aborts.
///   RPC_URL             the JSON-RPC endpoint (used by --rpc-url, recorded here)
///   PRIVATE_KEY         the EVM deployer key. Read through vm.envUint into a local,
///                       never printed, never logged. tPOT is native: fund the
///                       mapped SS58 account (node scripts/evm-native-address.mjs
///                       <0x address>), not the 0x address itself.
///   ATTESTER            the address allowed to publish state roots
///   TITLE_ID            bytes32
///   NATIVE_ASSET        bytes32
///   BACKING             bytes32
///   OWNER               address, the native owner named in the record
///   IDENTITY_HASH       bytes32, zero means the identity is cleared
///   VESTING_HASH        bytes32
///   PERMISSIONS_HASH    bytes32
///   REVISION            uint64
///   TOKEN_NAME          optional, "LEMO Title 1"
///   TOKEN_SYMBOL        optional, "LT1"
///
/// The script rebuilds the title record with `evmContract` set to the address the
/// token will actually be created at, hashes it, and refuses unless that digest
/// equals TITLE_COMMITMENT. That is the one check a deploy script can make that
/// matters: the commitment a gate is anchored to must name the gate.
///
/// This script has never been broadcast. Nothing in this repository is deployed.
/// Run `forge script script/Deploy.s.sol -vv` with DEPLOY_CONFIRM unset to see it
/// refuse, then read contracts/README.md.
contract Deploy is Script {
  function run() external returns (address hasher, address verifier, address feed, address token) {
    if (keccak256(bytes(_envOr("DEPLOY_CONFIRM", "no"))) != keccak256(bytes("yes"))) {
      revert("refusing to deploy: set DEPLOY_CONFIRM=yes");
    }

    uint256 deployerKey = vm.envUint("PRIVATE_KEY");
    address deployer = vm.addr(deployerKey);

    TitleRecord memory record = _record(deployer);
    bytes32 commitment = vm.envBytes32("TITLE_COMMITMENT");

    console2.log("chain id", block.chainid);
    console2.log("rpc", _envOr("RPC_URL", "(not set)"));
    console2.log("deployer", deployer);
    console2.log("attester", vm.envOr("ATTESTER", address(0)));
    console2.log("threshold", vm.envOr("THRESHOLD", uint256(0)));

    vm.startBroadcast(deployerKey);

    ReviveBlake2b256 reviveHash = new ReviveBlake2b256();
    SubstrateTrieVerifier trieVerifier = new SubstrateTrieVerifier(IBlake2b256(address(reviveHash)));

    // A threshold set is the independent root source. Without THRESHOLD, the
    // deploy falls back to the single attested feed; with it, the feed needs
    // ATTESTER_1..3 to agree before any root is accepted.
    uint256 threshold = vm.envOr("THRESHOLD", uint256(0));
    IRootFeed rootFeed;
    if (threshold == 0) {
      rootFeed = new RootFeed(vm.envAddress("ATTESTER"));
    } else {
      address[] memory attesters = new address[](3);
      attesters[0] = vm.envAddress("ATTESTER_1");
      attesters[1] = vm.envAddress("ATTESTER_2");
      attesters[2] = vm.envAddress("ATTESTER_3");
      rootFeed = new ThresholdRootFeed(attesters, threshold);
    }

    // The record names the token, so the token address has to be predicted
    // before the record can be hashed. Predict, verify the commitment against
    // that prediction, then deploy and confirm the prediction was right.
    address predicted = vm.computeCreateAddress(deployer, vm.getNonce(deployer));
    record.evmContract = predicted;
    require(
      TitleLib.hash(record) == commitment,
      "TITLE_COMMITMENT is not the commitment of the record naming the predicted token address"
    );

    TitleGateERC20 gate = new TitleGateERC20(
      trieVerifier,
      rootFeed,
      record.titleId,
      commitment,
      deployer,
      _envOr("TOKEN_NAME", "LEMO Title 1"),
      _envOr("TOKEN_SYMBOL", "LT1")
    );
    require(address(gate) == predicted, "token address prediction was wrong");

    vm.stopBroadcast();

    hasher = address(reviveHash);
    verifier = address(trieVerifier);
    feed = address(rootFeed);
    token = address(gate);

    console2.log("revive blake2b", hasher);
    console2.log("trie verifier", verifier);
    console2.log("root feed", feed);
    console2.log("token", token);
    console2.log("commitment", vm.toString(commitment));
    // The feed is left empty on purpose: only the attester's own wallet can
    // put a root in it, never this script.
    console2.log("next step: the attester must attest a finalized state root");
  }

  function _record(address deployer) private view returns (TitleRecord memory record) {
    record.titleId = vm.envBytes32("TITLE_ID");
    record.chainId = block.chainid;
    record.nativeAsset = vm.envBytes32("NATIVE_ASSET");
    record.backing = vm.envBytes32("BACKING");
    record.owner = vm.envAddress("OWNER");
    record.identityHash = vm.envBytes32("IDENTITY_HASH");
    record.vestingHash = vm.envBytes32("VESTING_HASH");
    record.permissionsHash = vm.envBytes32("PERMISSIONS_HASH");
    record.revision = uint64(vm.envUint("REVISION"));
    record.evmContract = deployer; // replaced with the prediction below
  }

  function _envOr(string memory key, string memory fallbackValue)
    private
    view
    returns (string memory)
  {
    return vm.envOr(key, fallbackValue);
  }
}
