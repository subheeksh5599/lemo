// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IRepresentation
/// @notice What the native side needs to know about an EVM representation to
/// apply Rule 2: while this returns true, unbonding is refused.
interface IRepresentation {
  /// @notice True while any representation of the title exists.
  function representationOutstanding() external view returns (bool);

  /// @notice The native record this representation currently follows. The
  /// guard reads it here rather than holding its own copy, so the two cannot
  /// drift apart across a revision change.
  function titleCommitment() external view returns (bytes32);
}
