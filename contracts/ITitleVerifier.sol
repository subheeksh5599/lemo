// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { TitleRecord } from "./LemoTitle.sol";

/// @title ITitleVerifier
/// @notice The only thing a gate knows about verifying a title: hand it a proof
/// and a commitment, get back a verdict and a decoded record.
///
/// The gates depend on this interface rather than on the concrete verifier for
/// one reason: the token rules (nullifiers, revisions, root freshness, operation
/// binding) must be testable without also building a trie, and a gate that is
/// only ever exercised through a real proof cannot show that it refuses a
/// verifier verdict it does not like. test/TitleGate.t.sol uses a mock of this
/// interface for the rule table and the real verifier for the end to end path.
interface ITitleVerifier {
  enum Status {
    NONE, // 0: never returned, and fails any PROVEN check
    PROVEN,
    ABSENT,
    INCOMPLETE,
    INVALID,
    ROOT_MISMATCH,
    VALUE_MISMATCH
  }

  /// @notice What a gate hands the verifier.
  struct TitleProof {
    bytes32 titleId;
    uint256 chainId;
    uint64 revision;
    address token;
    uint8 operation;
    bytes32 stateRoot;
    bytes32 storageKey;
    bytes[] nodes;
  }

  /// @notice Verify a title proof against the commitment the caller expects.
  /// @return status the verdict, PROVEN only when every binding held
  /// @return record the decoded native record, zeroed unless PROVEN
  function verifyTitle(TitleProof calldata proof, bytes32 expectedCommitment)
    external
    view
    returns (Status status, TitleRecord memory record);
}
