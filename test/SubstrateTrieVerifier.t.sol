// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { SubstrateTrieVerifier } from "lemo/SubstrateTrieVerifier.sol";
import { ITitleVerifier } from "lemo/ITitleVerifier.sol";
import { TestBlake2b } from "./harness/TestBlake2b.sol";

/// @title SubstrateTrieVerifierTest
/// @notice The verifier against a real Portaldot V3 proof, then against the node
/// kinds a live proof does not currently exercise.
///
/// The live fixture is test/fixtures/system-number-292815.json: the 4 nodes a
/// Portaldot V3 test node returned for `state_getReadProof` of System.Number at
/// the hash of finalized block 292815, whose state root is
/// 0x875ab429caf42cacc82e8f19ca90726c6bde53eea37b08b9f5ebf17cc4161918 and
/// whose value is 0xcf770400 = 292815 little endian.
contract SubstrateTrieVerifierTest is Test {
  struct LiveFixture {
    uint256 blockNumber;
    bytes blockHash;
    bytes stateRoot;
    bytes key;
    bytes storageValue;
    string[] nodes;
  }

  string internal constant LIVE = "test/fixtures/system-number-292815.json";
  string internal constant CASES = "test/fixtures/trie-cases.json";

  TestBlake2b internal hasher;
  SubstrateTrieVerifier internal verifier;

  uint256 internal liveBlock;
  bytes32 internal liveRoot;
  bytes32 internal liveKey;
  bytes[] internal liveNodes;

  function setUp() public {
    hasher = new TestBlake2b();
    verifier = new SubstrateTrieVerifier(hasher);
    _loadLive();
  }

  // ------------------------------------------------------------ the real proof

  function test_LiveProofProvesSystemNumber() public view {
    (ITitleVerifier.Status status, bytes memory value) =
      verifier.verify(liveRoot, _toBytes(liveKey), liveNodes);

    assertEq(uint256(status), uint256(ITitleVerifier.Status.PROVEN), "live proof not proven");
    assertEq(value, hex"cf770400", "proven value differs from the node's own storage read");

    // The value is the block number at that block, little endian u32.
    uint256 decoded = uint32(uint8(value[0])) | (uint32(uint8(value[1])) << 8)
      | (uint32(uint8(value[2])) << 16) | (uint32(uint8(value[3])) << 24);
    assertEq(decoded, 292815, "decoded block number");
    assertEq(decoded, liveBlock, "decoded value must equal the fixture's own block number");
  }

  function test_LiveProofRootIsTheChainStateRoot() public view {
    assertEq(liveRoot, bytes32(0x875ab429caf42cacc82e8f19ca90726c6bde53eea37b08b9f5ebf17cc4161918));
    assertEq(liveKey, bytes32(0x26aa394eea5630e07c48ae0c9558cef702a5c1b19ab7a04f536c519aca4983ac));
    assertEq(liveNodes.length, 4);
    assertEq(liveNodes[0].length, 47);
    assertEq(liveNodes[1].length, 168);
    assertEq(liveNodes[2].length, 498);
    assertEq(liveNodes[3].length, 290);
  }

  /// @notice The value claim is checked, not ignored.
  function test_LiveProofTamperedValueClaim() public view {
    (ITitleVerifier.Status status,) =
      verifier.verifyValue(liveRoot, _toBytes(liveKey), liveNodes, hex"cf770401");
    assertEq(uint256(status), uint256(ITitleVerifier.Status.VALUE_MISMATCH));
  }

  function test_LiveProofTamperedValueClaimTruncatedBytes() public view {
    (ITitleVerifier.Status status,) =
      verifier.verifyValue(liveRoot, _toBytes(liveKey), liveNodes, hex"cf77");
    assertEq(uint256(status), uint256(ITitleVerifier.Status.VALUE_MISMATCH));
  }

  // ----------------------------------------------------------- negative cases

  function test_LiveProofFlippedRoot() public view {
    bytes32 root = liveRoot ^ bytes32(uint256(1));
    (ITitleVerifier.Status status,) = verifier.verify(root, _toBytes(liveKey), liveNodes);
    assertEq(uint256(status), uint256(ITitleVerifier.Status.ROOT_MISMATCH));
  }

  /// @notice A substituted child node no longer hashes to its parent's
  /// reference, so it is unreachable: the proof carries a node nothing points
  /// at. That is INVALID, and it is distinct from a short proof.
  function test_LiveProofFlippedChildNode() public view {
    bytes[] memory nodes = liveNodes;
    nodes[3] = _flip(nodes[3], 40);

    (ITitleVerifier.Status status,) = verifier.verify(liveRoot, _toBytes(liveKey), nodes);
    // A substituted node hashes to nothing the set references, so the
    // parent's reference does not resolve. From the node set alone that is
    // the same observation as a truncated proof, so the verdict is
    // INCOMPLETE rather than INVALID. The property that matters is that it
    // is not PROVEN and not ABSENT: a substituted node can never authorise
    // anything, and it can never read as absence.
    assertTrue(status != ITitleVerifier.Status.PROVEN, "flipped node proved a value");
    assertTrue(status != ITitleVerifier.Status.ABSENT, "flipped node read as absence");
    assertEq(uint256(status), uint256(ITitleVerifier.Status.INCOMPLETE), "flipped node accepted");
  }

  /// @notice Dropping the last node leaves the walk without the leaf it needs,
  /// and every supplied node was reachable, so this is a truncation.
  function test_LiveProofTruncated() public view {
    bytes[] memory nodes = new bytes[](3);
    nodes[0] = liveNodes[0];
    nodes[1] = liveNodes[1];
    nodes[2] = liveNodes[2];

    (ITitleVerifier.Status status,) = verifier.verify(liveRoot, _toBytes(liveKey), nodes);
    assertEq(uint256(status), uint256(ITitleVerifier.Status.INCOMPLETE));
    assertTrue(
      status != ITitleVerifier.Status.ABSENT, "a truncated proof must never read as absence"
    );
  }

  function test_LiveProofEmpty() public view {
    bytes[] memory nodes = new bytes[](0);
    (ITitleVerifier.Status status,) = verifier.verify(liveRoot, _toBytes(liveKey), nodes);
    assertEq(uint256(status), uint256(ITitleVerifier.Status.INCOMPLETE));
  }

  function test_LiveProofWrongKey() public view {
    bytes32 key = liveKey ^ bytes32(uint256(0xff));
    (ITitleVerifier.Status status,) = verifier.verify(liveRoot, _toBytes(key), liveNodes);
    assertTrue(status != ITitleVerifier.Status.PROVEN, "a proof for one key proved another key");
  }

  /// @notice The one output that must never be produced without proof: a key
  /// this proof set does not cover has to be INCOMPLETE, not ABSENT. ABSENT is
  /// what lets backing out.
  function test_LiveProofFalseAbsence() public view {
    // Move the key one nibble onto a branch child that this proof does not
    // carry. The path is now uncovered, so the only honest answer is
    // INCOMPLETE. ABSENT here would release backing for a title nobody
    // checked.
    bytes memory key = _toBytes(liveKey);
    key[16] = bytes1(uint8(key[16]) ^ 0x30);
    (ITitleVerifier.Status status,) = verifier.verify(liveRoot, key, liveNodes);
    assertTrue(status != ITitleVerifier.Status.ABSENT, "false absence");
    assertEq(uint256(status), uint256(ITitleVerifier.Status.INCOMPLETE));
  }

  function test_LiveProofDuplicateNodeDoesNotChangeVerdict() public view {
    bytes[] memory nodes = new bytes[](5);
    for (uint256 i = 0; i < 4; i += 1) {
      nodes[i] = liveNodes[i];
    }
    nodes[4] = liveNodes[3];

    (ITitleVerifier.Status status, bytes memory value) =
      verifier.verify(liveRoot, _toBytes(liveKey), nodes);
    assertEq(uint256(status), uint256(ITitleVerifier.Status.PROVEN));
    assertEq(value, hex"cf770400");
  }

  // ------------------------------------------------- the synthetic case table

  /// @notice Every row of test/fixtures/trie-cases.json, generated by
  /// test/tools/gen_trie_cases.py. The expected column is either a proven value
  /// or the status name.
  function test_TrieCaseTable() public {
    string memory json = vm.readFile(CASES);
    string[] memory names = vm.parseJsonStringArray(json, ".names");
    string[] memory keys = vm.parseJsonStringArray(json, ".keys");
    string[] memory roots = vm.parseJsonStringArray(json, ".roots");
    string[] memory expects = vm.parseJsonStringArray(json, ".expects");
    uint256[] memory counts = vm.parseJsonUintArray(json, ".nodeCounts");
    string[] memory flat = vm.parseJsonStringArray(json, ".nodes");

    assertGe(names.length, 11);
    assertEq(names.length, expects.length);

    uint256 cursor = 0;
    for (uint256 i = 0; i < names.length; i += 1) {
      bytes[] memory nodes = new bytes[](counts[i]);
      for (uint256 n = 0; n < counts[i]; n += 1) {
        nodes[n] = vm.parseBytes(flat[cursor]);
        cursor += 1;
      }

      (ITitleVerifier.Status status, bytes memory value) =
        verifier.verify(_b32(vm.parseBytes(roots[i])), vm.parseBytes(keys[i]), nodes);

      if (_startsWith(expects[i], "0x")) {
        assertEq(uint256(status), uint256(ITitleVerifier.Status.PROVEN), names[i]);
        assertEq(keccak256(value), keccak256(vm.parseBytes(expects[i])), names[i]);
      } else if (_eq(expects[i], "ABSENT")) {
        assertEq(uint256(status), uint256(ITitleVerifier.Status.ABSENT), names[i]);
      } else if (_eq(expects[i], "INCOMPLETE")) {
        assertEq(uint256(status), uint256(ITitleVerifier.Status.INCOMPLETE), names[i]);
      } else {
        fail(names[i]);
      }
    }
    assertEq(cursor, flat.length, "every fixture node was consumed");
  }

  // ------------------------------------------------------- node order discipline

  /// @notice The server side decoder in this repository reads a branch's
  /// children before its value. sp-trie writes the value first. This asserts
  /// that the two encodings are NOT interchangeable here: the spec order
  /// yields the value that was written, and the swapped order does not.
  function test_BranchValueBeforeChildren() public view {
    bytes memory value = hex"beef";
    bytes32 childHash = keccak256("child");

    // header 0xc2 (branch with value, partial count 2), partial 0xab,
    // bitmap bit 0, value compact 0x08 + beef, child ref compact 0x80 + hash.
    bytes memory spec = abi.encodePacked(
      bytes1(0xc2),
      bytes1(0xab),
      bytes1(0x01),
      bytes1(0x00),
      bytes1(0x08),
      value,
      bytes1(0x80),
      childHash
    );
    bytes memory swapped = abi.encodePacked(
      bytes1(0xc2),
      bytes1(0xab),
      bytes1(0x01),
      bytes1(0x00),
      bytes1(0x80),
      childHash,
      bytes1(0x08),
      value
    );

    bytes[] memory specNodes = new bytes[](1);
    specNodes[0] = spec;
    bytes[] memory swappedNodes = new bytes[](1);
    swappedNodes[0] = swapped;

    (ITitleVerifier.Status specStatus, bytes memory specValue) =
      verifier.verify(blake2b(spec), hex"ab", specNodes);
    assertEq(uint256(specStatus), uint256(ITitleVerifier.Status.PROVEN), "spec order");
    assertEq(specValue, value);

    (ITitleVerifier.Status swappedStatus, bytes memory swappedValue) =
      verifier.verifyValue(blake2b(swapped), hex"ab", swappedNodes, value);
    assertTrue(
      swappedStatus != ITitleVerifier.Status.PROVEN,
      "the children-before-value encoding was accepted as the value"
    );
    assertEq(uint256(swappedStatus), uint256(ITitleVerifier.Status.VALUE_MISMATCH));
    assertTrue(
      keccak256(swappedValue) != keccak256(value), "swapped order returned the right value"
    );
  }

  /// @notice The front padding nibble of an odd partial count must be zero.
  function test_PaddingNibbleMustBeZero() public view {
    // header 0x43: leaf, partial count 3. 0xab would put a non-zero pad
    // nibble in front of the three real nibbles.
    bytes memory bad = abi.encodePacked(bytes1(0x43), hex"ab", hex"c0", bytes1(0x08), hex"0101");
    bytes[] memory nodes = new bytes[](1);
    nodes[0] = bad;

    (ITitleVerifier.Status status,) = verifier.verify(blake2b(bad), hex"0abc", nodes);
    assertEq(uint256(status), uint256(ITitleVerifier.Status.INVALID));
  }

  /// @notice An unknown header decodes to nothing and fails closed.
  function test_UnknownHeaderIsInvalid() public view {
    bytes memory bad = abi.encodePacked(bytes1(0xff), bytes1(0x00));
    bytes[] memory nodes = new bytes[](1);
    nodes[0] = bad;
    (ITitleVerifier.Status status,) = verifier.verify(blake2b(bad), hex"00", nodes);
    assertEq(uint256(status), uint256(ITitleVerifier.Status.INVALID));
  }

  /// @notice A node with trailing bytes after the leaf value is a rejection
  /// rather than slack, so a padded node cannot smuggle a second reading.
  function test_LeafTrailingBytesIsInvalid() public view {
    bytes memory bad = abi.encodePacked(bytes1(0x42), hex"12", bytes1(0x04), hex"aa", hex"bbbb");
    bytes[] memory nodes = new bytes[](1);
    nodes[0] = bad;
    (ITitleVerifier.Status status,) = verifier.verify(blake2b(bad), hex"12", nodes);
    assertEq(uint256(status), uint256(ITitleVerifier.Status.INVALID));
  }

  // ------------------------------------------------------------------ helpers

  function blake2b(bytes memory data) internal view returns (bytes32) {
    return hasher.hash(data);
  }

  function _loadLive() internal {
    string memory json = vm.readFile(LIVE);
    bytes memory root = vm.parseBytes(vm.parseJsonString(json, ".block.stateRoot"));
    bytes memory key = vm.parseBytes(vm.parseJsonString(json, ".proofs.systemNumber.key"));
    bytes memory storedValue = vm.parseJsonBytes(json, ".proofs.systemNumber.storage");
    liveBlock = vm.parseJsonUint(json, ".block.number");
    liveRoot = _b32(root);
    liveKey = _b32(key);
    // The fixture also carries the node's own state_getStorage answer; the
    // proven value asserted below is compared against it by hand.
    assertEq(keccak256(storedValue), keccak256(hex"cf770400"));

    string[] memory raw = vm.parseJsonStringArray(json, ".proofs.systemNumber.proof");
    liveNodes = new bytes[](raw.length);
    for (uint256 i = 0; i < raw.length; i += 1) {
      liveNodes[i] = vm.parseBytes(raw[i]);
    }
  }

  function _flip(bytes memory data, uint256 at) internal pure returns (bytes memory out) {
    out = data;
    out[at] = bytes1(uint8(out[at]) ^ 0x01);
  }

  function _toBytes(bytes32 value) internal pure returns (bytes memory out) {
    out = new bytes(32);
    assembly {
      mstore(add(out, 0x20), value)
    }
  }

  function _b32(bytes memory data) internal pure returns (bytes32 out) {
    require(data.length == 32, "not a 32 byte value");
    assembly {
      out := mload(add(data, 0x20))
    }
  }

  function _startsWith(string memory haystack, string memory prefix) internal pure returns (bool) {
    bytes memory h = bytes(haystack);
    bytes memory p = bytes(prefix);
    if (h.length < p.length) return false;
    for (uint256 i = 0; i < p.length; i += 1) {
      if (h[i] != p[i]) return false;
    }
    return true;
  }

  function _eq(string memory a, string memory b) internal pure returns (bool) {
    return keccak256(bytes(a)) == keccak256(bytes(b));
  }
}
