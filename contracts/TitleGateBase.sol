// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ITitleVerifier } from "./ITitleVerifier.sol";
import { TitleRecord } from "./LemoTitle.sol";
import { IRootFeed } from "./IRootFeed.sol";
import { IRepresentation } from "./IRepresentation.sol";

/// @title TitleGateBase
/// @notice The rule both representations share: no state change on the EVM face
/// without a finalized proof of the native face.
///
/// A gated call supplies the proof, and `_gate` binds it to all seven dimensions
/// before the token's storage moves:
///
///   chain        proof.chainId and the decoder's record chain must equal the
///                chain this token was deployed on (block.chainid at deploy)
///   titleId      the proof's id, the decoded record's id and the token's id
///   token        the proof's token and the decoded record's evmContract must be
///                this contract (an address comparison, not a caller check)
///   operation    transfer / mint / burn, compared with what is about to happen
///   revision     the decoded record's revision must equal the proof's, and it
///                may never go backwards from the last accepted one
///   state root   the proof's root must be the root the feed currently holds
///   commitment   the decoded record must hash to the commitment this token was
///                created with, which is what makes the fields non-substitutable
///
/// # Nullifiers: what one native revision authorises
///
///   mint, burn   keccak256(titleId, revision, operation, token). Revision
///                scoped: at most ONE mint and ONE burn per native revision,
///                whatever the root, the amount or the recipient. A new state
///                root at an unchanged revision does not re-authorise either
///                (audit H-01, C-01).
///   transfer     keccak256(titleId, revision, operation, actionHash, token),
///                actionHash = keccak256(from, to, amount|tokenId). Action
///                scoped: many distinct transfers per revision are legitimate
///                (the native record carries no per-transfer counter), so a
///                transfer proof is reusable for a DIFFERENT action at the same
///                revision, but the same action is never accepted twice at that
///                revision, including after the feed publishes a new root.
///                Transfers move existing supply only; they cannot create or
///                destroy it.
///
/// # Owner powers (a trusted role)
///
///   - pause: refuses new mints and transfers. It never refuses a burn, so
///     holders can always exit (audit M-03).
///   - commitment change: two step, `proposeTitleCommitment` then, no earlier
///     than COMMITMENT_DELAY later, `acceptTitleCommitment`. Holders see the
///     change coming and can exit before it lands. The owner can pick WHICH
///     real native record the token follows; it cannot invent one, because
///     every proof must still decode a record hashing to the commitment.
///
/// Everything fails closed: an unrecognised status, an empty feed, a cleared
/// identity, an unbound backing and a replayed proof all revert, and no storage
/// write precedes a check.
abstract contract TitleGateBase is IRepresentation {
  uint8 internal constant OP_TRANSFER = 1;
  uint8 internal constant OP_MINT = 2;
  uint8 internal constant OP_BURN = 3;

  /// @notice Minimum time between proposing and accepting a new commitment.
  uint256 public constant COMMITMENT_DELAY = 1 days;

  ITitleVerifier public immutable verifier;
  IRootFeed public immutable feed;
  bytes32 public immutable titleId;
  uint256 public immutable boundChainId;
  address public immutable owner;

  /// @notice Which native record this token represents: the commitment the
  /// decoded record must hash to. A newer revision is a different record, so
  /// this has to be advanced deliberately rather than matching any revision.
  bytes32 public titleCommitment;

  /// @notice A proposed next commitment and the earliest time it may land.
  bytes32 public pendingTitleCommitment;
  uint256 public pendingTitleCommitmentEta;

  /// @notice Highest revision a proof has been accepted at. Monotonic.
  uint64 public acceptedRevision;
  bool public paused;

  /// @notice Consumed authorisations, keyed by the nullifier.
  mapping(bytes32 => bool) public nullifierUsed;

  event Gated(
    address indexed actor,
    uint8 indexed operation,
    uint64 revision,
    bytes32 stateRoot,
    bytes32 nullifier
  );
  event PausedChanged(bool paused);
  event TitleCommitmentProposed(bytes32 indexed current, bytes32 indexed next, uint256 eta);
  event TitleCommitmentCancelled(bytes32 indexed next);
  event TitleCommitmentChanged(bytes32 indexed previous, bytes32 indexed next);
  event OwnerChanged(address indexed previous, address indexed next);

  error OnlyOwner();
  error GateIsPaused();
  error ZeroAddress();
  error FeedHasNoRoot();
  error FeedRootMismatch(bytes32 proven, bytes32 accepted);
  error ChainMismatch(uint256 proven, uint256 bound);
  error OperationMismatch(uint8 claimed, uint8 expected);
  error TokenMismatch(address claimed);
  error TitleIdMismatch(bytes32 claimed);
  error RevisionStale(uint64 claimed, uint64 accepted);
  error ProofRejected(uint8 status);
  error IdentityCleared();
  error BackingNotBound();
  error ProofReplayed(bytes32 nullifier);
  error SameOwnerAndRecipient();
  error ZeroCommitment();
  error CommitmentUnchanged();
  error NoPendingCommitment();
  error CommitmentTimelocked(uint256 eta, uint256 nowTs);
  error RecipientNotProven(address proven, address claimed);

  constructor(
    ITitleVerifier verifier_,
    IRootFeed feed_,
    bytes32 titleId_,
    bytes32 titleCommitment_,
    address owner_
  ) {
    if (address(verifier_) == address(0) || address(feed_) == address(0) || owner_ == address(0)) revert ZeroAddress();
    if (titleCommitment_ == bytes32(0)) revert ZeroCommitment();
    verifier = verifier_;
    feed = feed_;
    titleId = titleId_;
    titleCommitment = titleCommitment_;
    boundChainId = block.chainid;
    owner = owner_;
    emit OwnerChanged(address(0), owner_);
  }

  modifier onlyOwner() {
    if (msg.sender != owner) revert OnlyOwner();
    _;
  }

  modifier whenNotPaused() {
    if (paused) revert GateIsPaused();
    _;
  }

  /// @notice Schedule the commitment of a newer revision of this title.
  /// Replaces any earlier proposal and restarts the delay.
  function proposeTitleCommitment(bytes32 next) external onlyOwner {
    if (next == bytes32(0)) revert ZeroCommitment();
    if (next == titleCommitment) revert CommitmentUnchanged();
    uint256 eta = block.timestamp + COMMITMENT_DELAY;
    pendingTitleCommitment = next;
    pendingTitleCommitmentEta = eta;
    emit TitleCommitmentProposed(titleCommitment, next, eta);
  }

  /// @notice Land the proposed commitment once the delay has passed.
  /// @dev Does not relax any check: the next proof must still prove a record
  /// that hashes to the new commitment, at the feed's current root, at a
  /// revision at or above the accepted one.
  function acceptTitleCommitment() external onlyOwner {
    bytes32 next = pendingTitleCommitment;
    if (next == bytes32(0)) revert NoPendingCommitment();
    if (block.timestamp < pendingTitleCommitmentEta) {
      revert CommitmentTimelocked(pendingTitleCommitmentEta, block.timestamp);
    }
    emit TitleCommitmentChanged(titleCommitment, next);
    titleCommitment = next;
    delete pendingTitleCommitment;
    delete pendingTitleCommitmentEta;
  }

  function cancelTitleCommitment() external onlyOwner {
    bytes32 next = pendingTitleCommitment;
    if (next == bytes32(0)) revert NoPendingCommitment();
    delete pendingTitleCommitment;
    delete pendingTitleCommitmentEta;
    emit TitleCommitmentCancelled(next);
  }

  /// @notice Refuse new mints and transfers. Burns stay open: a pause can stop
  /// value entering or moving, never a holder leaving.
  function setPaused(bool next) external onlyOwner {
    paused = next;
    emit PausedChanged(next);
  }

  /// @dev Mint and burn: one per native revision (see the contract notes).
  function _gateRevision(uint8 operation, ITitleVerifier.TitleProof calldata proof)
    internal
    returns (TitleRecord memory)
  {
    return _gate(
      operation, keccak256(abi.encode(titleId, proof.revision, operation, address(this))), proof
    );
  }

  /// @dev Transfers: one per (revision, action).
  function _gateAction(uint8 operation, bytes32 actionHash, ITitleVerifier.TitleProof calldata proof)
    internal
    returns (TitleRecord memory)
  {
    return _gate(
      operation,
      keccak256(abi.encode(titleId, proof.revision, operation, actionHash, address(this))),
      proof
    );
  }

  /// @dev Run every binding check, consume the nullifier, and hand back the
  /// decoded native record. Reverts on anything less than a fully bound,
  /// current, unreplayed proof. Pausing is the caller's decision, not this
  /// function's, so that burns can bypass it.
  function _gate(uint8 operation, bytes32 nullifier, ITitleVerifier.TitleProof calldata proof)
    private
    returns (TitleRecord memory record)
  {
    bytes32 accepted = feed.currentRoot();
    if (accepted == bytes32(0)) revert FeedHasNoRoot();
    if (proof.stateRoot != accepted) revert FeedRootMismatch(proof.stateRoot, accepted);

    if (proof.chainId != boundChainId || block.chainid != boundChainId) {
      revert ChainMismatch(proof.chainId, boundChainId);
    }
    if (proof.operation != operation) revert OperationMismatch(proof.operation, operation);
    if (proof.token != address(this)) revert TokenMismatch(proof.token);
    if (proof.titleId != titleId) revert TitleIdMismatch(proof.titleId);
    if (proof.revision < acceptedRevision) revert RevisionStale(proof.revision, acceptedRevision);

    (ITitleVerifier.Status status, TitleRecord memory record_) =
      verifier.verifyTitle(proof, titleCommitment);
    if (status != ITitleVerifier.Status.PROVEN) revert ProofRejected(uint8(status));

    if (record_.identityHash == bytes32(0)) revert IdentityCleared();
    if (record_.backing == bytes32(0)) revert BackingNotBound();

    if (nullifierUsed[nullifier]) revert ProofReplayed(nullifier);

    nullifierUsed[nullifier] = true;
    acceptedRevision = proof.revision;

    emit Gated(msg.sender, operation, proof.revision, proof.stateRoot, nullifier);
    return record_;
  }

  /// @inheritdoc IRepresentation
  /// @dev Rule 2 in the protocol: native unbonding is refused while this is
  /// true.
  function representationOutstanding() public view virtual override returns (bool);
}
