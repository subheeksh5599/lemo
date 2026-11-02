// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title RootFeed
/// @notice The only place a state root enters the gate. One attester publishes
/// the state root of a finalized native block, and every gate compares the root
/// in a proof against it.
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
///   - the attester may publish a root that is older than the last one, which is
///     how a stale proof becomes acceptable again (a reorg the gate cannot see);
///   - the owner may replace the attester at any time.
///
/// Pinned mode removes most of that: `pin` fixes one root forever and refuses
/// every later attestation. A pinned feed is a one shot deployment: the pinned
/// block is the last state anything can prove. Pinning is irreversible by
/// construction, since an unpin would make the pin decorative.
contract RootFeed {
  address public owner;
  address public attester;
  bool public pinned;

  bytes32 public currentRoot;
  uint256 public currentBlockNumber;

  event Attested(bytes32 indexed root, uint256 blockNumber, address indexed attester);
  event Pinned(bytes32 indexed root, uint256 blockNumber);
  event AttesterChanged(address indexed previous, address indexed next);
  event OwnerChanged(address indexed previous, address indexed next);

  error OnlyOwner();
  error OnlyAttester();
  error FeedIsPinned();
  error ZeroAddress();
  error ZeroRoot();

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

  /// @notice Publish the state root of a finalized native block.
  function attest(bytes32 root, uint256 blockNumber) external onlyAttester {
    if (pinned) revert FeedIsPinned();
    if (root == bytes32(0)) revert ZeroRoot();
    currentRoot = root;
    currentBlockNumber = blockNumber;
    emit Attested(root, blockNumber, msg.sender);
  }

  /// @notice Fix the current root forever. Refuses if the feed is empty,
  /// because pinning nothing would pin a feed that can never prove anything.
  function pin() external onlyAttester {
    if (pinned) revert FeedIsPinned();
    if (currentRoot == bytes32(0)) revert ZeroRoot();
    pinned = true;
    emit Pinned(currentRoot, currentBlockNumber);
  }

  /// @notice Pin an explicit root in one step.
  function pinTo(bytes32 root, uint256 blockNumber) external onlyAttester {
    if (pinned) revert FeedIsPinned();
    if (root == bytes32(0)) revert ZeroRoot();
    currentRoot = root;
    currentBlockNumber = blockNumber;
    pinned = true;
    emit Attested(root, blockNumber, msg.sender);
    emit Pinned(root, blockNumber);
  }

  function setAttester(address next) external onlyOwner {
    if (pinned) revert FeedIsPinned();
    if (next == address(0)) revert ZeroAddress();
    emit AttesterChanged(attester, next);
    attester = next;
  }

  function setOwner(address next) external onlyOwner {
    if (next == address(0)) revert ZeroAddress();
    emit OwnerChanged(owner, next);
    owner = next;
  }

  /// @notice True when a root has been published and can be compared.
  function live() external view returns (bool) {
    return currentRoot != bytes32(0);
  }
}
