// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { TitleLib, TitleRecord } from "lemo/LemoTitle.sol";
import { ITitleVerifier } from "lemo/ITitleVerifier.sol";
import { SubstrateTrieVerifier } from "lemo/SubstrateTrieVerifier.sol";
import { RootFeed } from "lemo/RootFeed.sol";
import { TitleGateERC20 } from "lemo/TitleGateERC20.sol";
import { TitleGateBase } from "lemo/TitleGateBase.sol";
import { UnbondGuard } from "lemo/UnbondGuard.sol";
import { TestBlake2b } from "harness/TestBlake2b.sol";

/// @title LocalE2ETest
/// @notice Replays the EVM half of `fixtures/local-e2e.json`, the recorded
/// local lifecycle (scripts/local-e2e.mjs), against the same contracts at the
/// same addresses anvil gave them. Every proof is read from the fixture: the
/// state roots, storage key, 320 byte value and trie nodes came from a
/// finalized block of the local LEMO runtime, with a GRANDPA justification.
///
/// The run itself is recorded with anvil tx hashes in the fixture; this test
/// is the reproducible check that the captured bytes still drive the gate the
/// same way after any contract change.
contract LocalE2ETest is Test {
  uint8 internal constant OP_TRANSFER = 1;
  uint8 internal constant OP_MINT = 2;
  uint8 internal constant OP_BURN = 3;

  string internal json;

  address internal deployer;
  address internal beneficiary;
  address internal bob;

  TestBlake2b internal hasher;
  SubstrateTrieVerifier internal verifier;
  RootFeed internal feed;
  TitleGateERC20 internal gate;
  UnbondGuard internal guard;

  uint256 internal maxSupply;
  uint256 internal moved;
  TitleRecord internal record;

  function setUp() public {
    json = vm.readFile("../fixtures/local-e2e.json");
    vm.chainId(vm.parseJsonUint(json, ".evm.chainId"));

    deployer = vm.parseJsonAddress(json, ".evm.accounts.deployer");
    beneficiary = vm.parseJsonAddress(json, ".evm.accounts.beneficiary");
    bob = vm.parseJsonAddress(json, ".evm.accounts.bob");
    maxSupply = vm.parseJsonUint(json, ".evm.maxSupply");
    moved = vm.parseJsonUint(json, ".evm.transferAmount");

    hasher = TestBlake2b(vm.parseJsonAddress(json, ".evm.contracts.hasher"));
    verifier = SubstrateTrieVerifier(vm.parseJsonAddress(json, ".evm.contracts.verifier"));
    feed = RootFeed(vm.parseJsonAddress(json, ".evm.contracts.feed"));
    gate = TitleGateERC20(vm.parseJsonAddress(json, ".evm.contracts.gate"));
    guard = UnbondGuard(vm.parseJsonAddress(json, ".evm.contracts.guard"));

    bytes memory value = vm.parseJsonBytes(json, ".proofs.A.value");
    (bool ok, TitleRecord memory r) = TitleLib.decodeNative(value);
    require(ok, "proof A value does not decode");
    record = r;
    bytes32 commitment = TitleLib.hash(r);
    assertEq(commitment, vm.parseJsonBytes32(json, ".evm.titleCommitment"), "commitment as recorded");

    deployCodeTo("TestBlake2b.sol:TestBlake2b", address(hasher));
    deployCodeTo("lemo-contracts/SubstrateTrieVerifier.sol:SubstrateTrieVerifier", abi.encode(address(hasher)), address(verifier));
    deployCodeTo("lemo-contracts/RootFeed.sol:RootFeed", abi.encode(deployer), address(feed));
    deployCodeTo(
      "lemo-contracts/TitleGateERC20.sol:TitleGateERC20",
      abi.encode(
        address(verifier), address(feed), r.titleId, commitment, deployer, "LEMO Local Title", "LEMO-L", maxSupply
      ),
      address(gate)
    );
    deployCodeTo(
      "lemo-contracts/UnbondGuard.sol:UnbondGuard",
      abi.encode(address(verifier), address(feed), address(gate), r.titleId, deployer),
      address(guard)
    );
  }

  /// @notice The native record names the gate the run deployed, the anvil
  /// beneficiary and the anvil chain, at revision 2 (create, then bind).
  function test_RecordIsBoundToTheRecordedGate() public view {
    assertEq(record.titleId, vm.parseJsonBytes32(json, ".native.titleId"));
    assertEq(record.evmContract, address(gate), "record names the gate");
    assertEq(record.owner, beneficiary, "word 4 is the evm beneficiary");
    assertEq(record.chainId, block.chainid);
    assertEq(record.revision, 2);
  }

  /// @notice The header bytes hash to the justified block hash, so the state
  /// root the proof is walked against is the one in that header.
  function test_HeadersHashToTheJustifiedBlocks() public view {
    string[3] memory ids = ["A", "B", "C"];
    for (uint256 i = 0; i < ids.length; i++) {
      string memory p = string.concat(".proofs.", ids[i]);
      bytes memory encoded = vm.parseJsonBytes(json, string.concat(p, ".header.encoded"));
      assertEq(hasher.hash(encoded), vm.parseJsonBytes32(json, string.concat(p, ".header.hash")));
      assertEq(
        vm.parseJsonBytes32(json, string.concat(p, ".justification.targetHash")),
        vm.parseJsonBytes32(json, string.concat(p, ".header.hash"))
      );
    }
  }

  /// @notice Rule 1 and Rule 2 on the EVM side, in the order the run did them.
  function test_ReplaysTheRecordedLifecycle() public {
    ITitleVerifier.TitleProof memory p;

    _attest("A");
    p = _proof("A", OP_MINT);
    gate.mint(beneficiary, maxSupply, p);
    assertEq(gate.totalSupply(), maxSupply);
    assertTrue(gate.representationOutstanding());

    p = _proof("A", OP_TRANSFER);
    vm.prank(beneficiary);
    gate.transfer(bob, moved, p);
    assertEq(gate.balanceOf(bob), moved);

    // The same action again: refused, as the recorded reverted tx was.
    vm.prank(beneficiary);
    vm.expectRevert();
    gate.transfer(bob, moved, p);

    // Guard refuses while supply exists.
    p = _proof("A", OP_BURN);
    vm.expectRevert(UnbondGuard.RepresentationOutstanding.selector);
    guard.requestUnbond(p);

    // A newer finalized root lands; the older root no longer authorises.
    _attest("B");
    p = _proof("A", OP_TRANSFER);
    vm.prank(bob);
    vm.expectRevert();
    gate.transfer(beneficiary, moved, p);

    p = _proof("B", OP_TRANSFER);
    vm.prank(bob);
    gate.transfer(beneficiary, moved, p);
    assertEq(gate.balanceOf(beneficiary), maxSupply);

    p = _proof("B", OP_BURN);
    vm.prank(beneficiary);
    gate.burn(beneficiary, maxSupply, p);
    assertEq(gate.totalSupply(), 0);
    assertFalse(gate.representationOutstanding());

    vm.prank(beneficiary);
    bytes32 id = guard.requestUnbond(p);
    vm.prank(deployer);
    guard.completeUnbond(id);
    assertTrue(guard.released());
  }

  /// @notice After finalize_unbond the canonical key is gone: proof C walks to
  /// ABSENT against its own finalized root.
  function test_ProofCShowsTheRecordDeleted() public view {
    (ITitleVerifier.Status status,) = verifier.verify(
      vm.parseJsonBytes32(json, ".proofs.C.header.stateRoot"),
      vm.parseJsonBytes(json, ".proofs.C.storageKey"),
      vm.parseJsonBytesArray(json, ".proofs.C.proofNodes")
    );
    assertEq(uint8(status), uint8(ITitleVerifier.Status.ABSENT));
  }

  // ------------------------------------------------------------------ helpers

  function _attest(string memory id) internal {
    string memory p = string.concat(".proofs.", id, ".header");
    vm.prank(deployer);
    feed.attest(vm.parseJsonBytes32(json, string.concat(p, ".stateRoot")), vm.parseJsonUint(json, string.concat(p, ".number")));
  }

  function _proof(string memory id, uint8 operation) internal view returns (ITitleVerifier.TitleProof memory proof) {
    string memory p = string.concat(".proofs.", id);
    proof.titleId = record.titleId;
    proof.chainId = record.chainId;
    proof.revision = record.revision;
    proof.token = address(gate);
    proof.operation = operation;
    proof.stateRoot = vm.parseJsonBytes32(json, string.concat(p, ".header.stateRoot"));
    proof.storageKey = vm.parseJsonBytes(json, string.concat(p, ".storageKey"));
    proof.nodes = vm.parseJsonBytesArray(json, string.concat(p, ".proofNodes"));
  }
}
