// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IBlake2b256
/// @notice The one hash dependency the trie verifier has.
///
/// Substrate's state trie hashes every node with blake2_256 (BLAKE2b, 32 byte
/// digest, unkeyed). The verifier never implements the hash itself: production
/// code injects `ReviveBlake2b256` (which calls the chain's System precompile)
/// and the test suite injects a pure Solidity reference implementation. A
/// verifier whose hash could be swapped at call time would be a verifier with
/// no root of trust, so the implementation is fixed in the constructor.
interface IBlake2b256 {
  function hash(bytes memory data) external view returns (bytes32);
}
