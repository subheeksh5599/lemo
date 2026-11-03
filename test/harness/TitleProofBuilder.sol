// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IBlake2b256 } from "lemo/IBlake2b256.sol";
import { ITitleVerifier } from "lemo/ITitleVerifier.sol";
import { TitleLib, TitleRecord } from "lemo/LemoTitle.sol";
import { Blake2b256 } from "./Blake2b256.sol";

/// @title TitleProofBuilder
/// @notice Builds a title proof that the real verifier accepts, with real hashes
/// and a real trie walk, for the title record the caller supplies.
///
/// Storage key: the pallet's canonical location, byte for byte what
/// `LemoTitle::CanonicalTitles` uses on the native chain:
///
///   twox128("LemoTitle") ++ twox128("CanonicalTitles")   32 bytes, frozen prefix
///   ++ blake2_128(titleId)                               16 bytes
///   ++ titleId                                           32 bytes (Blake2_128Concat)
///
/// The prefix is taken from the captured local chain key
/// (fixtures/lemo-local-capture.json, canonicalStorageKey), and blake2_128 is
/// computed here with the real algorithm, so the keys this builder emits are the
/// keys the chain would use for the same title id.
///
/// Shape: one leaf holding the whole 80 byte storage key, whose value is a
/// separate node (the 320 byte native record). Header 0x3f is "leaf whose value
/// is its own node" with an all-ones 5 bit count, so a continuation byte
/// follows: 0x81 means count = 30 + 129 + 1 = 160 nibbles, the whole key. The
/// root is blake2b-256 of that leaf, computed here, not taken from anywhere.
contract TitleProofBuilder {
  bytes32 public constant CANONICAL_TITLES_PREFIX =
    0x4f03c24a87564f16d6105c855e7a6d375ec2a7664a464914b341c4ef2eeb96a0;

  IBlake2b256 public immutable hasher;

  constructor(IBlake2b256 hasher_) {
    hasher = hasher_;
  }

  function storageKey(bytes32 titleId) public pure returns (bytes memory) {
    return abi.encodePacked(
      CANONICAL_TITLES_PREFIX, Blake2b256.hash128(abi.encodePacked(titleId)), titleId
    );
  }

  /// @notice The 114 byte leaf that commits the record under an 80 byte key.
  function leafFor(bytes memory key, bytes32 valueHash) public pure returns (bytes memory) {
    require(key.length == 80, "builder emits 80 byte keys only");
    return abi.encodePacked(bytes1(0x3f), bytes1(0x81), key, valueHash);
  }

  /// @notice Root and node set for one record.
  function proofFor(TitleRecord memory record, uint8 operation, address token)
    external
    view
    returns (ITitleVerifier.TitleProof memory proof, bytes32 root, bytes32 commitment)
  {
    bytes memory encoded = TitleLib.encodeNative(record);
    bytes memory keyBytes = storageKey(record.titleId);
    bytes32 valueHash = hasher.hash(encoded);
    bytes memory leaf = leafFor(keyBytes, valueHash);
    proof.titleId = record.titleId;
    proof.chainId = block.chainid;
    proof.revision = record.revision;
    proof.token = token;
    proof.operation = operation;
    proof.stateRoot = hasher.hash(leaf);
    proof.storageKey = keyBytes;
    proof.nodes = new bytes[](2);
    proof.nodes[0] = leaf;
    proof.nodes[1] = encoded;

    root = proof.stateRoot;
    commitment = TitleLib.hash(record);
  }

  /// @notice The same proof with its state root replaced, for stale-root tests.
  function withRoot(ITitleVerifier.TitleProof memory proof, bytes32 root)
    external
    pure
    returns (ITitleVerifier.TitleProof memory)
  {
    proof.stateRoot = root;
    return proof;
  }

  /// @notice The same proof aimed at another token, for wrong-token tests.
  function withToken(ITitleVerifier.TitleProof memory proof, address token)
    external
    pure
    returns (ITitleVerifier.TitleProof memory)
  {
    proof.token = token;
    return proof;
  }

  /// @notice The same proof claiming another operation.
  function withOperation(ITitleVerifier.TitleProof memory proof, uint8 operation)
    external
    pure
    returns (ITitleVerifier.TitleProof memory)
  {
    proof.operation = operation;
    return proof;
  }
}
