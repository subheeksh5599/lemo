// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IRootFeed } from "./IRootFeed.sol";

/// @title RootFeed
/// @notice The single attester root source. One attester publishes the state
/// root of a finalized native block, and every gate compares the root in a
/// proof against it. Prefer ThresholdRootFeed; this exists for local and
/// single operator deployments and reports `quorum() == 1` so nobody can
/// mistake it for a quorum feed.
///
/// # Trust model (read this before trusting anything here)
///
/// This contract does not verify that the root belongs to a finalized block: an
/// EVM contract cannot see the native chain's header chain. It authenticates an
/// EOA. Everything above it (the trie walk, the record decode, the commitment,
/// the nullifier) is trustless given the root; the root itself is a single
/// attester's word:
///
///   - the attester may publish any root, including one from a block that is not
///     final, or from a fork, or from nothing at all;
///   - the attester can NOT publish a root for a block at or below the current
///     one: the block number is strictly monotonic (audit H-07), so an older
///     root cannot be replayed to make a stale proof acceptable again;
///   - the owner may replace the attester, but only in two steps: the owner
///     proposes, ATTESTER_DELAY passes, and the NEW attester accepts. A key
///     that cannot sign cannot become the attester, and the change is public
///     for a day before it lands. Ownership is two step as well.
///
/// Pinned mode removes most of that: `pin` fixes one root forever and refuses
/// every later attestation. A pinned feed is a one shot deployment: the pinned
/// block is the last state anything can prove. Pinning is irreversible by
/// construction, since an unpin would make the pin decorative.
contract RootFeed is IRootFeed {
  /// @notice Minimum time between proposing and accepting a new attester.
  uint256 public constant ATTESTER_DELAY = 1 days;

  address public owner;
  address public pendingOwner;
  address public attester;
  address public pendingAttester;
  uint256 public pendingAttesterEta;
  bool public pinned;

  bytes32 public currentRoot;
  uint256 public currentBlockNumber;

  event Attested(bytes32 indexed root, uint256 blockNumber, address indexed attester);
  event Pinned(bytes32 indexed root, uint256 blockNumber);
  event AttesterProposed(address indexed current, address indexed next, uint256 eta);
  event AttesterProposalCancelled(address indexed next);
  event AttesterChanged(address indexed previous, address indexed next);
  event OwnerProposed(address indexed current, address indexed next);
  event OwnerChanged(address indexed previous, address indexed next);

  error OnlyOwner();
  error OnlyAttester();
  error OnlyPendingAttester();
  error OnlyPendingOwner();
  error FeedIsPinned();
  error ZeroAddress();
  error ZeroRoot();
  error BlockNotNewer(uint256 claimed, uint256 accepted);
  error AttesterTimelocked(uint256 eta, uint256 nowTs);
  error NoPendingAttester();

  constructor(address attester_) {
    if (attester_ == address(0)) revert ZeroAddress();
    owner = msg.sender;
    attester = attester_;
    emit OwnerChanged(address(0), msg.sender);
    emit AttesterChanged(address(0), attester_);
  }

  modifier onlyOwner() {
    if (msg.sender != owner) revert OnlyOwner();
    _;
  }

  modifier onlyAttester() {
    if (msg.sender != attester) revert OnlyAttester();
    _;
  }

  /// @notice Publish the state root of a finalized native block. The block
  /// number must be strictly greater than the current one.
  function attest(bytes32 root, uint256 blockNumber) external onlyAttester {
    _accept(root, blockNumber);
  }

  /// @notice Fix the current root forever. Refuses if the feed is empty,
  /// because pinning nothing would pin a feed that can never prove anything.
  function pin() external onlyAttester {
    if (pinned) revert FeedIsPinned();
    if (currentRoot == bytes32(0)) revert ZeroRoot();
    pinned = true;
    emit Pinned(currentRoot, currentBlockNumber);
  }

  /// @notice Pin an explicit root in one step. Same monotonic rule as attest.
  function pinTo(bytes32 root, uint256 blockNumber) external onlyAttester {
    _accept(root, blockNumber);
    pinned = true;
    emit Pinned(root, blockNumber);
  }

  function _accept(bytes32 root, uint256 blockNumber) private {
    if (pinned) revert FeedIsPinned();
    if (root == bytes32(0)) revert ZeroRoot();
    if (blockNumber <= currentBlockNumber) revert BlockNotNewer(blockNumber, currentBlockNumber);
    currentRoot = root;
    currentBlockNumber = blockNumber;
    emit Attested(root, blockNumber, msg.sender);
  }

  // ------------------------------------------------------------ rotation

  /// @notice Step one of an attester change. Replaces any earlier proposal.
  function proposeAttester(address next) external onlyOwner {
    if (pinned) revert FeedIsPinned();
    if (next == address(0)) revert ZeroAddress();
    uint256 eta = block.timestamp + ATTESTER_DELAY;
    pendingAttester = next;
    pendingAttesterEta = eta;
    emit AttesterProposed(attester, next, eta);
  }

  function cancelAttesterProposal() external onlyOwner {
    address next = pendingAttester;
    if (next == address(0)) revert NoPendingAttester();
    delete pendingAttester;
    delete pendingAttesterEta;
    emit AttesterProposalCancelled(next);
  }

  /// @notice Step two: the proposed attester takes the role itself, after the
  /// delay.
  function acceptAttester() external {
    if (pinned) revert FeedIsPinned();
    if (pendingAttester == address(0)) revert NoPendingAttester();
    if (msg.sender != pendingAttester) revert OnlyPendingAttester();
    if (block.timestamp < pendingAttesterEta) {
      revert AttesterTimelocked(pendingAttesterEta, block.timestamp);
    }
    emit AttesterChanged(attester, msg.sender);
    attester = msg.sender;
    delete pendingAttester;
    delete pendingAttesterEta;
  }

  function proposeOwner(address next) external onlyOwner {
    if (next == address(0)) revert ZeroAddress();
    pendingOwner = next;
    emit OwnerProposed(owner, next);
  }

  function acceptOwner() external {
    if (msg.sender != pendingOwner) revert OnlyPendingOwner();
    emit OwnerChanged(owner, msg.sender);
    owner = msg.sender;
    delete pendingOwner;
  }

  /// @notice True when a root has been published and can be compared.
  function live() external view returns (bool) {
    return currentRoot != bytes32(0);
  }

  /// @inheritdoc IRootFeed
  function quorum() external pure returns (uint256) {
    return 1;
  }
}
