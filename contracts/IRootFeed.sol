// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice The only surface a gate needs from a root source.
interface IRootFeed {
  function currentRoot() external view returns (bytes32);
  function currentBlockNumber() external view returns (uint256);
  function live() external view returns (bool);

  /// @notice How many independent attesters must agree before a root lands.
  /// 1 for the single attester feed; the threshold for a quorum feed. Lets a
  /// consumer (or a deploy check) assert it was handed a quorum feed.
  function quorum() external view returns (uint256);
}
