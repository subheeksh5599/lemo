// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IRootFeed } from "./IRootFeed.sol";

/// @title ThresholdRootFeed
/// @notice A root source that needs an explicit quorum of independent attesters.
///
/// One attester can lie. This feed accepts a `(root, blockNumber)` only after
/// `threshold` distinct attesters have submitted the same pair.
///
/// What this fixes relative to `RootFeed`:
///   - no single key can move the accepted root;
///   - the same proposal needs a quorum, so a mistaken or malicious attester is
///     outvoted;
///   - the accepted block number is monotonic, so an older root cannot replace a
///     newer one.
///
/// Proposal hygiene (audit M-02):
///   - an attester may `revoke` its approval of a proposal that has not
///     finalized;
///   - a proposal expires PROPOSAL_TTL_BLOCKS EVM blocks after its first
///     approval; later approvals start a fresh round, so stale approvals cannot
///     be combined with a new one into a quorum;
///   - once a root is live, a proposal may be at most MAX_FUTURE_BLOCKS native
///     blocks ahead of it, so a quorum cannot jump the feed to a bogus far
///     future height that would freeze every honest proof. The very first root
///     has no reference point and is not bounded.
///
/// Attester rotation is explicit, delayed and evented: the owner schedules a
/// one for one replacement, anyone executes it after ATTESTER_CHANGE_DELAY, and
/// executing it voids every in-flight proposal (a removed key's approvals stop
/// counting). The set size and the threshold never change. The owner is a
/// trusted role with exactly this power and a two step handover.
///
/// What this does not fix: the attesters are still off-chain signers, and
/// nothing on chain can show that they are independent entities. The feed
/// authenticates a quorum, not the native chain's finality. A light client or a
/// runtime bridge is the only way to remove that assumption.
contract ThresholdRootFeed is IRootFeed {
  uint256 public constant PROPOSAL_TTL_BLOCKS = 7200;
  uint256 public constant MAX_FUTURE_BLOCKS = 100_800;
  uint256 public constant ATTESTER_CHANGE_DELAY = 2 days;

  address[] public attesters;
  mapping(address => bool) public isAttester;
  uint256 public immutable threshold;

  address public owner;
  address public pendingOwner;

  bytes32 public currentRoot;
  uint256 public currentBlockNumber;

  /// @notice Bumped on every attester replacement; proposals opened under an
  /// older set are void.
  uint64 public setVersion = 1;

  struct Proposal {
    uint64 openedAt;
    uint64 setVersion;
    uint32 epoch;
    uint32 count;
  }

  struct Replacement {
    address removed;
    address added;
    uint256 eta;
  }

  mapping(bytes32 => Proposal) private _proposals;
  mapping(bytes32 => mapping(address => uint32)) private _approvedEpoch;

  Replacement public pendingReplacement;

  event Approved(
    bytes32 indexed proposal,
    bytes32 indexed root,
    uint256 blockNumber,
    address indexed attester,
    uint256 approvals
  );
  event Revoked(
    bytes32 indexed proposal, bytes32 indexed root, uint256 blockNumber, address indexed attester
  );
  event Finalized(bytes32 indexed root, uint256 blockNumber, uint256 approvals);
  event AttesterReplacementScheduled(address indexed removed, address indexed added, uint256 eta);
  event AttesterReplacementCancelled(address indexed removed, address indexed added);
  event AttesterRemoved(address indexed attester);
  event AttesterAdded(address indexed attester);
  event OwnerProposed(address indexed current, address indexed next);
  event OwnerChanged(address indexed previous, address indexed next);

  error ThresholdOutOfRange(uint256 threshold, uint256 attesters);
  error DuplicateAttester(address attester);
  error ZeroAddress();
  error NotAttester(address caller);
  error ZeroRoot();
  error BlockNotNewer(uint256 claimed, uint256 accepted);
  error BlockTooFarAhead(uint256 claimed, uint256 maxAllowed);
  error AlreadyApproved();
  error NotApproved();
  error OnlyOwner();
  error OnlyPendingOwner();
  error ReplacementPending();
  error NoPendingReplacement();
  error ReplacementTimelocked(uint256 eta, uint256 nowTs);

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
    owner = msg.sender;
    emit OwnerChanged(address(0), msg.sender);
  }

  modifier onlyOwner() {
    if (msg.sender != owner) revert OnlyOwner();
    _;
  }

  modifier onlyAttester() {
    if (!isAttester[msg.sender]) revert NotAttester(msg.sender);
    _;
  }

  // ------------------------------------------------------------ approvals

  /// @notice Approve one root at one native block. The threshold crossing is the
  /// only thing that changes `currentRoot`.
  function attest(bytes32 root, uint256 blockNumber) external onlyAttester {
    if (root == bytes32(0)) revert ZeroRoot();
    _requireOpenHeight(blockNumber);
    if (currentBlockNumber != 0 && blockNumber > currentBlockNumber + MAX_FUTURE_BLOCKS) {
      revert BlockTooFarAhead(blockNumber, currentBlockNumber + MAX_FUTURE_BLOCKS);
    }

    bytes32 proposal = keccak256(abi.encode(root, blockNumber));
    Proposal storage p = _proposals[proposal];
    if (!_isLive(p)) {
      // Fresh round: earlier approvals (expired, or under an older attester
      // set) no longer count.
      p.epoch += 1;
      p.openedAt = uint64(block.number);
      p.setVersion = setVersion;
      p.count = 0;
    }
    if (_approvedEpoch[proposal][msg.sender] == p.epoch) revert AlreadyApproved();

    _approvedEpoch[proposal][msg.sender] = p.epoch;
    p.count += 1;
    emit Approved(proposal, root, blockNumber, msg.sender, p.count);

    if (p.count >= threshold) {
      currentRoot = root;
      currentBlockNumber = blockNumber;
      emit Finalized(root, blockNumber, p.count);
    }
  }

  /// @notice Withdraw an approval before the proposal finalizes.
  function revoke(bytes32 root, uint256 blockNumber) external onlyAttester {
    _requireOpenHeight(blockNumber);
    bytes32 proposal = keccak256(abi.encode(root, blockNumber));
    Proposal storage p = _proposals[proposal];
    if (!_isLive(p) || _approvedEpoch[proposal][msg.sender] != p.epoch) revert NotApproved();
    delete _approvedEpoch[proposal][msg.sender];
    p.count -= 1;
    emit Revoked(proposal, root, blockNumber, msg.sender);
  }

  /// @notice Live approvals for a proposal: zero once it expired or the
  /// attester set changed under it.
  function approvals(bytes32 proposal) external view returns (uint256) {
    Proposal storage p = _proposals[proposal];
    return _isLive(p) ? p.count : 0;
  }

  function approved(bytes32 proposal, address attester) external view returns (bool) {
    Proposal storage p = _proposals[proposal];
    return _isLive(p) && _approvedEpoch[proposal][attester] == p.epoch;
  }

  function _isLive(Proposal storage p) private view returns (bool) {
    return p.count != 0 && p.setVersion == setVersion
      && block.number <= uint256(p.openedAt) + PROPOSAL_TTL_BLOCKS;
  }

  function _requireOpenHeight(uint256 blockNumber) private view {
    if (blockNumber <= currentBlockNumber) {
      revert BlockNotNewer(blockNumber, currentBlockNumber);
    }
  }

  // ------------------------------------------------------------ rotation

  /// @notice Schedule replacing one attester with another. One at a time.
  function scheduleAttesterReplacement(address removed, address added) external onlyOwner {
    if (pendingReplacement.eta != 0) revert ReplacementPending();
    if (!isAttester[removed]) revert NotAttester(removed);
    if (added == address(0)) revert ZeroAddress();
    if (isAttester[added]) revert DuplicateAttester(added);
    uint256 eta = block.timestamp + ATTESTER_CHANGE_DELAY;
    pendingReplacement = Replacement(removed, added, eta);
    emit AttesterReplacementScheduled(removed, added, eta);
  }

  function cancelAttesterReplacement() external onlyOwner {
    Replacement memory r = pendingReplacement;
    if (r.eta == 0) revert NoPendingReplacement();
    delete pendingReplacement;
    emit AttesterReplacementCancelled(r.removed, r.added);
  }

  /// @notice Land a scheduled replacement after the delay. Permissionless: the
  /// decision was the owner's and has been public for the whole delay.
  function executeAttesterReplacement() external {
    Replacement memory r = pendingReplacement;
    if (r.eta == 0) revert NoPendingReplacement();
    if (block.timestamp < r.eta) revert ReplacementTimelocked(r.eta, block.timestamp);
    if (!isAttester[r.removed]) revert NotAttester(r.removed);
    if (isAttester[r.added]) revert DuplicateAttester(r.added);
    delete pendingReplacement;

    for (uint256 i = 0; i < attesters.length; i += 1) {
      if (attesters[i] == r.removed) {
        attesters[i] = r.added;
        break;
      }
    }
    isAttester[r.removed] = false;
    isAttester[r.added] = true;
    setVersion += 1;
    emit AttesterRemoved(r.removed);
    emit AttesterAdded(r.added);
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

  // ------------------------------------------------------------ views

  function live() external view returns (bool) {
    return currentRoot != bytes32(0);
  }

  /// @inheritdoc IRootFeed
  function quorum() external view returns (uint256) {
    return threshold;
  }

  function attesterCount() external view returns (uint256) {
    return attesters.length;
  }
}
