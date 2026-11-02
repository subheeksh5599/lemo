// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice The only surface a gate needs from a root source.
interface IRootFeed {
  function currentRoot() external view returns (bytes32);
  function currentBlockNumber() external view returns (uint256);
  function live() external view returns (bool);
}
