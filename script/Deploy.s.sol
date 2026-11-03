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
///   RPC_URL             the JSON-RPC endpoint, passed to --rpc-url only. Never
///                       read or logged here: provider URLs often embed API keys.
///   PRIVATE_KEY         the EVM deployer key. Read through vm.envUint into a local,
///                       never printed, never logged. tPOT is native: fund the
///                       mapped SS58 account (node scripts/evm-native-address.mjs
///                       <0x address>), not the 0x address itself.
///   FEED_MODE           required, exactly "threshold" or "single". No default:
///                       a missing value refuses instead of silently deploying
///                       the single key feed.
///     threshold         ATTESTER_1..3 and THRESHOLD (2 or 3). THRESHOLD=1 is
///                       refused: one of three is a single key with a quorum name.
///     single            ATTESTER, the one address allowed to publish roots.
///   GATE_OWNER          required, the token owner (pause, commitment changes).
///                       Use a multisig or timelock; it is immutable on the gate.
///                       Also proposed as owner of the feed (it must accept).
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

    bool thresholdMode = _feedMode();
    address gateOwner = vm.envAddress("GATE_OWNER");
    require(gateOwner != address(0), "GATE_OWNER must be set");

    // Chain id, not the RPC URL: the URL may carry a provider API key (M-05).
    console2.log("chain id", block.chainid);
    console2.log("deployer", deployer);
    console2.log("gate owner", gateOwner);
    console2.log("feed mode", thresholdMode ? "threshold" : "single");

    vm.startBroadcast(deployerKey);

    ReviveBlake2b256 reviveHash = new ReviveBlake2b256();
    SubstrateTrieVerifier trieVerifier = new SubstrateTrieVerifier(IBlake2b256(address(reviveHash)));

    IRootFeed rootFeed = thresholdMode ? _thresholdFeed(gateOwner, deployer) : _singleFeed(gateOwner, deployer);

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
      gateOwner,
      _envOr("TOKEN_NAME", "LEMO Title 1"),
      _envOr("TOKEN_SYMBOL", "LT1"),
      vm.envOr("MAX_SUPPLY", uint256(1_000_000e18))
    );
    require(address(gate) == predicted, "token address prediction was wrong");

    vm.stopBroadcast();

    hasher = address(reviveHash);
    verifier = address(trieVerifier);
    feed = address(rootFeed);
    token = address(gate);
    _logResult(hasher, verifier, rootFeed, token, commitment);
  }

  function _logResult(
    address hasher,
    address verifier,
    IRootFeed rootFeed,
    address token,
    bytes32 commitment
  ) private view {
    console2.log("revive blake2b", hasher);
    console2.log("trie verifier", verifier);
    console2.log("root feed", address(rootFeed));
    console2.log("feed quorum", rootFeed.quorum());
    console2.log("token", token);
    console2.log("commitment", vm.toString(commitment));
    // The feed is left empty on purpose: only the attester's own wallet can
    // put a root in it, never this script.
    console2.log("next step: the attester must attest a finalized state root");
  }

  /// @dev FEED_MODE is required and must be one of the two literal values.
  function _feedMode() private view returns (bool thresholdMode) {
    bytes32 mode = keccak256(bytes(_envOr("FEED_MODE", "")));
    if (mode == keccak256("threshold")) return true;
    if (mode == keccak256("single")) return false;
    revert("FEED_MODE must be exactly \"threshold\" or \"single\"");
  }

  /// @dev 2-of-3 or 3-of-3 over three distinct attesters (the constructor
  /// rejects duplicates and zero addresses).
  function _thresholdFeed(address gateOwner, address deployer) private returns (IRootFeed) {
    uint256 threshold = vm.envUint("THRESHOLD");
    require(threshold >= 2 && threshold <= 3, "THRESHOLD must be 2 or 3 with three attesters");
    address[] memory attesters = new address[](3);
    attesters[0] = vm.envAddress("ATTESTER_1");
    attesters[1] = vm.envAddress("ATTESTER_2");
    attesters[2] = vm.envAddress("ATTESTER_3");
    ThresholdRootFeed f = new ThresholdRootFeed(attesters, threshold);
    require(f.quorum() == threshold, "feed quorum mismatch");
    if (gateOwner != deployer) f.proposeOwner(gateOwner);
    return f;
  }

  function _singleFeed(address gateOwner, address deployer) private returns (IRootFeed) {
    RootFeed f = new RootFeed(vm.envAddress("ATTESTER"));
    if (gateOwner != deployer) f.proposeOwner(gateOwner);
    return f;
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
