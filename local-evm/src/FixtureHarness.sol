// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { TitleLib, TitleRecord } from "lemo/LemoTitle.sol";
import { ITitleVerifier } from "lemo/ITitleVerifier.sol";
import { SubstrateTrieVerifier } from "lemo/SubstrateTrieVerifier.sol";
import { IBlake2b256 } from "lemo/IBlake2b256.sol";
import { TitleGateERC20 } from "lemo/TitleGateERC20.sol";
import { Blake2b256 } from "harness/Blake2b256.sol";

/// @title FixtureHarness
/// @notice Local-only helper that holds the committed fixture bytes and turns
/// them into calls a shell script can drive with cast. It is not part of the
/// protocol; the verification itself runs through the deployed
/// SubstrateTrieVerifier and the gate's own code.
///
/// Two proof shapes live here and they are deliberately distinct:
///
///   fixtureProof        the capture's own nodes, key and root. Its 80 byte
///                       Substrate key cannot fit ITitleVerifier.TitleProof's
///                       bytes32 storageKey, so this is truncated to the first
///                       32 bytes and the trie walk reports ABSENT.
///   derivedProof        the fixture's decoded record with `evmContract` set to
///                       the gate, hashed into a repository-style 32 byte
///                       keccak key. This is NOT the fixture: it exists to show
///                       the gate accepting when a record names the token.
contract FixtureHarness {
  uint8 internal constant OP_TRANSFER = 1;
  uint8 internal constant OP_MINT = 2;

  SubstrateTrieVerifier public immutable verifier;
  bytes32 public immutable fixtureRoot;

  bytes internal canonicalValue;
  bytes internal canonicalKey;
  bytes[] internal fixtureNodes;

  TitleRecord public record;
  bytes32 public commitment;

  constructor(
    SubstrateTrieVerifier verifier_,
    bytes memory canonicalValue_,
    bytes32 fixtureRoot_,
    bytes memory canonicalKey_,
    bytes[] memory nodes_
  ) {
    require(canonicalValue_.length == 320, "fixture value is not 320 bytes");
    (bool ok, TitleRecord memory r) = TitleLib.decodeNative(canonicalValue_);
    require(ok, "fixture value does not decode");

    verifier = verifier_;
    fixtureRoot = fixtureRoot_;
    canonicalValue = canonicalValue_;
    canonicalKey = canonicalKey_;
    fixtureNodes = nodes_;
    record = r;
    commitment = TitleLib.hash(r);
  }

  // ------------------------------------------------------------ fixture shape

  function canonicalLength() external view returns (uint256) {
    return canonicalValue.length;
  }

  function canonicalKeyLength() external view returns (uint256) {
    return canonicalKey.length;
  }

  function decodeFixture() external view returns (bool ok, uint256 length) {
    (ok,) = TitleLib.decodeNative(canonicalValue);
    length = canonicalValue.length;
  }

  /// @notice The fixture trie walked with the fixture's real 80 byte key.
  function verifyFixture() external view returns (uint8 status, uint256 valueLen, bytes32 valueHash) {
    (ITitleVerifier.Status st, bytes memory value) =
      verifier.verify(fixtureRoot, canonicalKey, fixtureNodes);
    status = uint8(st);
    valueLen = value.length;
    valueHash = Blake2b256.hash(value);
  }

  /// @notice The same fixture squeezed into TitleProof: bytes32 key, so only the
  /// first 32 of 80 bytes survive.
  function fixtureProof(address token, uint8 operation)
    public
    view
    returns (ITitleVerifier.TitleProof memory proof)
  {
    proof.titleId = record.titleId;
    proof.chainId = record.chainId;
    proof.revision = record.revision;
    proof.token = token;
    proof.operation = operation;
    proof.stateRoot = fixtureRoot;
    proof.storageKey = canonicalKey;
    proof.nodes = fixtureNodes;
  }

  function mintCalldataFixture(address token, address to, uint256 amount)
    external
    view
    returns (bytes memory)
  {
    return abi.encodeCall(TitleGateERC20.mint, (to, amount, fixtureProof(token, OP_MINT)));
  }

  // ------------------------------------------------------------ derived shape

  /// @notice The fixture record with the EVM contract bound to `token`.
  function boundRecord(address token) public view returns (TitleRecord memory r) {
    r = record;
    r.evmContract = token;
  }

  function derivedRoot(address token) external view returns (bytes32) {
    (, bytes32 root,) = derivedProof(token, OP_MINT);
    return root;
  }

  function derivedCommitment(address token) external view returns (bytes32) {
    return TitleLib.hash(boundRecord(token));
  }

  /// @notice A repository-style proof (32 byte keccak key, 0x3f21 leaf) for the
  /// bound record. Not the capture's trie.
  function derivedProof(address token, uint8 operation)
    public
    view
    returns (ITitleVerifier.TitleProof memory proof, bytes32 root, bytes32 recordCommitment)
  {
    TitleRecord memory bound = boundRecord(token);
    bytes memory encoded = TitleLib.encodeNative(bound);
    bytes32 key = keccak256(abi.encode("LEMO.NATIVE.TITLE", bound.titleId));
    bytes32 valueHash = Blake2b256.hash(encoded);
    bytes memory leaf = abi.encodePacked(bytes1(0x3f), bytes1(0x21), key, valueHash);

    proof.titleId = bound.titleId;
    proof.chainId = bound.chainId;
    proof.revision = bound.revision;
    proof.token = token;
    proof.operation = operation;
    proof.stateRoot = Blake2b256.hash(leaf);
    proof.storageKey = abi.encodePacked(key);
    proof.nodes = new bytes[](2);
    proof.nodes[0] = leaf;
    proof.nodes[1] = encoded;

    root = proof.stateRoot;
    recordCommitment = TitleLib.hash(bound);
  }

  function mintCalldataDerived(address token, address to, uint256 amount)
    external
    view
    returns (bytes memory)
  {
    (ITitleVerifier.TitleProof memory proof,,) = derivedProof(token, OP_MINT);
    return abi.encodeCall(TitleGateERC20.mint, (to, amount, proof));
  }

  function transferCalldataDerived(address token, address to, uint256 amount)
    external
    view
    returns (bytes memory)
  {
    (ITitleVerifier.TitleProof memory proof,,) = derivedProof(token, OP_TRANSFER);
    return abi.encodeCall(TitleGateERC20.transfer, (to, amount, proof));
  }

  // ------------------------------------------------------------------ helpers
}
