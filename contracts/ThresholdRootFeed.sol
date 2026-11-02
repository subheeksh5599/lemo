// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IRootFeed } from "./IRootFeed.sol";

/// @title ThresholdRootFeed
/// @notice A root source that needs an explicit quorum of independent attesters.
///
/// One attester can lie. This feed accepts a `(root, blockNumber)` only after
/// `threshold` distinct attesters have submitted the same pair. The set is fixed
/// at deployment, so no owner can swap an attester after the fact.
///
/// What this fixes relative to `RootFeed`:
///   - no single key can move the accepted root;
///   - the same proposal needs a quorum, so a mistaken or malicious attester is
///     outvoted;
///   - the accepted block number is monotonic, so an older root cannot replace a
///     newer one.
///
/// What this does not fix: the attesters are still off-chain signers. The feed
/// authenticates a quorum, not the native chain's finality. A light client or a
/// runtime bridge is the only way to remove that assumption.
contract ThresholdRootFeed is IRootFeed {
  address[] public attesters;
  mapping(address => bool) public isAttester;
  uint256 public immutable threshold;

  bytes32 public currentRoot;
  uint256 public currentBlockNumber;

  mapping(bytes32 => uint256) public approvals;
  mapping(bytes32 => mapping(address => bool)) public approved;

  event Approved(
    bytes32 indexed proposal,
    bytes32 indexed root,
    uint256 blockNumber,
    address indexed attester,
    uint256 approvals
  );
  event Finalized(bytes32 indexed root, uint256 blockNumber, uint256 approvals);

  error ThresholdOutOfRange(uint256 threshold, uint256 attesters);
  error DuplicateAttester(address attester);
  error ZeroAddress();
  error NotAttester(address caller);
  error ZeroRoot();
  error BlockNotNewer(uint256 claimed, uint256 accepted);
  error AlreadyApproved();

  constructor(address[] memory attesters_, uint256 threshold_) {
    if (threshold_ == 0 || threshold_ > attesters_.length) {
      revert ThresholdOutOfRange(threshold_, attesters_.length);
    }

    for (uint256 i = 0; i < attesters_.length; i += 1) {
      address attester = attesters_[i];
      if (attester == address(0)) revert ZeroAddress();
      if (isAttester[attester]) revert DuplicateAttester(attester);
      isAttester[attester] = true;
      attesters.push(attester);
    }

    threshold = threshold_;
  }

  /// @notice Approve one root at one native block. The threshold crossing is the
  /// only thing that changes `currentRoot`.
  function attest(bytes32 root, uint256 blockNumber) external {
    if (!isAttester[msg.sender]) revert NotAttester(msg.sender);
    if (root == bytes32(0)) revert ZeroRoot();
    if (blockNumber <= currentBlockNumber) {
      revert BlockNotNewer(blockNumber, currentBlockNumber);
    }

    bytes32 proposal = keccak256(abi.encode(root, blockNumber));
    if (approved[proposal][msg.sender]) revert AlreadyApproved();

    approved[proposal][msg.sender] = true;
    approvals[proposal] += 1;
    emit Approved(proposal, root, blockNumber, msg.sender, approvals[proposal]);

    if (approvals[proposal] >= threshold) {
      currentRoot = root;
      currentBlockNumber = blockNumber;
      emit Finalized(root, blockNumber, approvals[proposal]);
    }
  }

  function live() external view returns (bool) {
    return currentRoot != bytes32(0);
  }

  function attesterCount() external view returns (uint256) {
    return attesters.length;
  }
}
