// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IBlake2b256 } from "lemo/IBlake2b256.sol";
import { ITitleVerifier } from "lemo/ITitleVerifier.sol";
import { TitleLib, TitleRecord } from "lemo/LemoTitle.sol";

/// @title TitleProofBuilder
/// @notice Builds a title proof that the real verifier accepts, with real hashes
/// and a real trie walk, for the title record the caller supplies.
///
/// Shape: one leaf holding the whole 32 byte storage key, whose value is a
/// separate node (the 320 byte native record). Header 0x3f is "leaf whose value
/// is its own node" with an all-ones 5 bit count, so a continuation byte
/// follows: 0x21 means count = 30 + 33 + 1 = 64 nibbles, the whole key. The root
/// is blake2b-256 of that leaf, computed here, not taken from anywhere.
///
/// The native registry is not deployed, so the storage key is a documented
/// derivation of this repository's own: keccak256("LEMO.NATIVE.TITLE", titleId).
/// A real native map would use twox128(pallet) ++ twox128(item) ++ a map hasher
/// over the title id. The verifier takes the key as an input and is agnostic.
contract TitleProofBuilder {
  IBlake2b256 public immutable hasher;

  constructor(IBlake2b256 hasher_) {
    hasher = hasher_;
  }

  function storageKey(bytes32 titleId) public pure returns (bytes32) {
    return keccak256(abi.encode("LEMO.NATIVE.TITLE", titleId));
  }

  /// @notice The 66 byte leaf that commits the record.
  function leafFor(bytes32 key, bytes32 valueHash) public pure returns (bytes memory) {
    return abi.encodePacked(bytes1(0x3f), bytes1(0x21), key, valueHash);
  }

  /// @notice Root and node set for one record.
  function proofFor(TitleRecord memory record, uint8 operation, address token)
    external
    view
    returns (ITitleVerifier.TitleProof memory proof, bytes32 root, bytes32 commitment)
  {
    bytes memory encoded = TitleLib.encodeNative(record);
    bytes32 key = storageKey(record.titleId);
    bytes32 valueHash = hasher.hash(encoded);
    bytes memory leaf = leafFor(key, valueHash);

    proof.titleId = record.titleId;
    proof.chainId = block.chainid;
    proof.revision = record.revision;
    proof.token = token;
    proof.operation = operation;
    proof.stateRoot = hasher.hash(leaf);
    proof.storageKey = key;
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
