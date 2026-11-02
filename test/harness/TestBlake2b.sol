// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IBlake2b256 } from "lemo/IBlake2b256.sol";
import { Blake2b256 } from "./Blake2b256.sol";

/// @title TestBlake2b
/// @notice The test-only hash dependency. It is the real algorithm, not a stub:
/// a mock returning canned digests would let every proof test pass without any
/// hashing happening.
contract TestBlake2b is IBlake2b256 {
  /// @inheritdoc IBlake2b256
  function hash(bytes memory data) external pure returns (bytes32) {
    return Blake2b256.hash(data);
  }

  /// @notice In-process variant so a test can hash without an external call.
  function hashMemory(bytes memory data) external pure returns (bytes32) {
    return Blake2b256.hash(data);
  }
}
