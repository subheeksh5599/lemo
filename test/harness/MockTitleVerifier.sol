// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ITitleVerifier } from "lemo/ITitleVerifier.sol";
import { TitleLib, TitleRecord } from "lemo/LemoTitle.sol";

/// @title MockTitleVerifier
/// @notice A verifier whose verdict the test picks, so the gate's own rules can
/// be exercised without building a trie for every case.
///
/// It is deliberately not a blanket "return whatever I am told": it recomputes
/// the commitment from the record it will return and refuses when the caller's
/// expected commitment differs, so a gate configured with the wrong commitment
/// still fails here. Everything else (the trie, the root, the signature of the
/// record) is the real verifier's job and is covered by
/// test/SubstrateTrieVerifier.t.sol and the end to end case in
/// test/TitleGate.t.sol.
contract MockTitleVerifier is ITitleVerifier {
  struct Answer {
    Status status;
    TitleRecord record;
    bytes32 commitment;
  }

  Answer public answer;

  error CommitmentNotBuilt();

  function set(Status status, TitleRecord calldata record) external {
    answer.status = status;
    answer.record = record;
    answer.commitment = TitleLib.hash(record);
  }

  function setStatus(Status status) external {
    answer.status = status;
  }

  /// @inheritdoc ITitleVerifier
  function verifyTitle(TitleProof calldata, bytes32 expectedCommitment)
    external
    view
    returns (Status, TitleRecord memory)
  {
    if (answer.commitment != expectedCommitment) {
      return (Status.VALUE_MISMATCH, answer.record);
    }
    return (answer.status, answer.record);
  }
}
