// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { TitleLib, TitleRecord } from "lemo/LemoTitle.sol";
import { ITitleVerifier } from "lemo/ITitleVerifier.sol";
import { SubstrateTrieVerifier } from "lemo/SubstrateTrieVerifier.sol";
import { RootFeed } from "lemo/RootFeed.sol";
import { TitleGateERC20 } from "lemo/TitleGateERC20.sol";
import { TitleGateBase } from "lemo/TitleGateBase.sol";
import { TestBlake2b } from "harness/TestBlake2b.sol";
import { TitleProofBuilder } from "harness/TitleProofBuilder.sol";

/// @title FixtureTitleTest
/// @notice What the committed local capture actually proves, and what it does
/// not. The fixture is the proof source throughout: its bytes are read from
/// `fixtures/lemo-local-capture.json`, never rebuilt.
///
/// Proven here:
///   - the canonical value is exactly 320 bytes and decodes through
///     TitleLib.decodeNative, re-encoding byte for byte;
///   - the fixture's four nodes verify through the real SubstrateTrieVerifier
///     against the fixture's finalized state root, for the fixture's 80 byte
///     storage key, and yield the canonical value;
///   - TitleProof now carries `bytes storageKey`, so the real gate mints and
///     transfers from the fixture itself (no derived record).
contract NonceBump {}

contract FixtureTitleTest is Test {
  uint8 internal constant OP_MINT = 2;
  uint8 internal constant OP_TRANSFER = 1;

  bytes32 internal fixtureRoot;

  TestBlake2b internal hasher;
  SubstrateTrieVerifier internal verifier;
  TitleGateERC20 internal gate;
  RootFeed internal feed;
  TitleProofBuilder internal builder;

  bytes internal canonicalValue;
  bytes internal canonicalKey;
  bytes[] internal proofNodes;
  bytes32 internal commitment;
  TitleRecord internal record;

  function setUp() public {
    // At the fixture's chain id: the verifier checks it against block.chainid.
    vm.chainId(420_420_777);

    string memory json = vm.readFile("../fixtures/lemo-local-capture.json");
    canonicalValue = vm.parseJsonBytes(json, ".canonicalValue");
    canonicalKey = vm.parseJsonBytes(json, ".canonicalStorageKey");
    proofNodes = vm.parseJsonBytesArray(json, ".canonicalProofNodes");
    fixtureRoot = vm.parseJsonBytes32(json, ".finalized.stateRoot");

    hasher = new TestBlake2b();
    verifier = new SubstrateTrieVerifier(hasher);
    new NonceBump();
    builder = new TitleProofBuilder(hasher);
    feed = new RootFeed(address(this));

    (bool ok, TitleRecord memory r) = TitleLib.decodeNative(canonicalValue);
    assertTrue(ok, "canonical 320 bytes must decode");
    record = r;
    commitment = TitleLib.hash(r);

    gate = new TitleGateERC20(
      ITitleVerifier(address(verifier)),
      feed,
      r.titleId,
      commitment,
      address(this),
      "LEMO Local Title",
      "LEMO-L",
      1_000_000e18
    );
  }

  /// @notice The fixture value is ten 32 byte words and every field decodes to
  /// what the capture reported.
  function test_CanonicalValueIs320BytesAndDecodes() public view {
    assertEq(canonicalValue.length, 320, "canonical value length");
    assertEq(record.titleId, 0xee00000000000000000000000000000000000000000000000000000000000000);
    assertEq(record.chainId, 420_420_777);
    assertEq(
      record.nativeAsset, bytes32(0xabababababababababababababababababababababababababababababababab)
    );
    assertEq(
      record.backing, bytes32(0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd)
    );
    assertEq(record.owner, address(0x04A99FD6822C8558854CCde39a5684e7A56dA27d));
    assertEq(
      record.identityHash,
      bytes32(uint256(0x1111111111111111111111111111111111111111111111111111111111111111))
    );
    assertEq(
      record.vestingHash,
      bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222))
    );
    assertEq(
      record.permissionsHash,
      bytes32(uint256(0x3333333333333333333333333333333333333333333333333333333333333333))
    );
    assertEq(record.evmContract, address(gate), "fixture record is bound to the gate");
    assertEq(record.revision, 3);
    assertEq(TitleLib.encodeNative(record), canonicalValue, "re-encode is byte identical");
  }

  /// @notice 319 and 321 byte blobs are refused: the layout is fixed width.
  /// The fixture's own `canonicalValueBytes: 321` metadata would fail here.
  function test_DecodeRejectsWrongLength() public pure {
    bytes memory short = new bytes(319);
    bytes memory long = new bytes(321);
    (bool okShort,) = TitleLib.decodeNative(short);
    (bool okLong,) = TitleLib.decodeNative(long);
    assertFalse(okShort, "319 bytes must not decode");
    assertFalse(okLong, "321 bytes must not decode");
  }

  /// @notice The fixture's four nodes verify through the real verifier at the
  /// fixture root with the fixture's own 80 byte storage key.
  function test_FixtureTrieVerifiesWithFullKey() public view {
    (ITitleVerifier.Status status, bytes memory value) =
      verifier.verify(fixtureRoot, canonicalKey, proofNodes);

    assertEq(uint8(status), uint8(ITitleVerifier.Status.PROVEN), "status");
    assertEq(value.length, 320, "proven value length");
    assertEq(value, canonicalValue, "proven value is the canonical record");
  }

  /// @notice verifyTitle accepts the fixture's full 80 byte storage key now that
  /// the proof struct carries `bytes`, and the record binds back to the token.
  function test_VerifyTitleAcceptsTheFixtureKey() public view {
    ITitleVerifier.TitleProof memory proof = _fixtureProof(address(gate), OP_MINT);
    (ITitleVerifier.Status status,) = verifier.verifyTitle(proof, commitment);
    assertEq(uint8(status), uint8(ITitleVerifier.Status.PROVEN), "fixture proof is PROVEN");
  }

  /// @notice A real ERC20 gate at the fixture root mints and transfers from the
  /// fixture proof, with no derived record and no truncated key.
  function test_GateMintsAndTransfersFromFixture() public {
    feed.attest(fixtureRoot, 5);

    ITitleVerifier.TitleProof memory mintProof = _fixtureProof(address(gate), OP_MINT);
    gate.mint(record.owner, 100, mintProof);

    assertEq(gate.totalSupply(), 100, "supply minted");
    assertEq(gate.balanceOf(record.owner), 100, "owner balance");

    ITitleVerifier.TitleProof memory transferProof = _fixtureProof(address(gate), OP_TRANSFER);
    vm.prank(record.owner);
    gate.transfer(address(0xB0B), 40, transferProof);

    assertEq(gate.balanceOf(record.owner), 60);
    assertEq(gate.balanceOf(address(0xB0B)), 40);
    assertEq(gate.acceptedRevision(), 3);
  }

  /// @notice A derived record (same fixture fields, evmContract set to the
  /// gate) with a repository style 32 byte keccak key is accepted end to end.
  /// This is NOT the fixture proof: it is a binding drill that shows the gate
  /// works once a record names the token and the key fits the struct.
  function test_DerivedBoundRecordMintsAndTransfers() public {
    TitleRecord memory bound = record;
    bound.evmContract = address(gate);

    (ITitleVerifier.TitleProof memory mintProof, bytes32 root,) =
      builder.proofFor(bound, OP_MINT, address(gate));
    bytes32 boundCommitment = TitleLib.hash(bound);

    feed.attest(root, 7);
    gate.setTitleCommitment(boundCommitment);

    gate.mint(record.owner, 1000, mintProof);
    assertEq(gate.balanceOf(record.owner), 1000);

    (ITitleVerifier.TitleProof memory transferProof,,) =
      builder.proofFor(bound, OP_TRANSFER, address(gate));
    vm.prank(record.owner);
    gate.transfer(address(0xB0B), 400, transferProof);

    assertEq(gate.balanceOf(record.owner), 600);
    assertEq(gate.balanceOf(address(0xB0B)), 400);
    assertEq(gate.acceptedRevision(), 3);
  }

  // ------------------------------------------------------------------ helpers

  function _fixtureProof(address token, uint8 operation) internal view returns (ITitleVerifier.TitleProof memory proof) {
    proof.titleId = record.titleId;
    proof.chainId = record.chainId;
    proof.revision = record.revision;
    proof.token = token;
    proof.operation = operation;
    proof.stateRoot = fixtureRoot;
    proof.storageKey = canonicalKey;
    proof.nodes = proofNodes;
  }
}
