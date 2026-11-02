// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ITitleVerifier } from "./ITitleVerifier.sol";
import { TitleLib, TitleRecord } from "./LemoTitle.sol";
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
/// A nullifier per (titleId, revision, operation, action, token) is consumed
/// on success, so replaying the same action with the same proof cannot work —
/// including after the feed publishes a new state root.
///
/// Everything fails closed: an unrecognised status, an empty feed, a cleared
/// identity, an unbound backing and a replayed proof all revert, and no storage
/// write precedes a check.
abstract contract TitleGateBase is IRepresentation {
  uint8 internal constant OP_TRANSFER = 1;
  uint8 internal constant OP_MINT = 2;
  uint8 internal constant OP_BURN = 3;

  ITitleVerifier public immutable verifier;
  IRootFeed public immutable feed;
  bytes32 public immutable titleId;
  uint256 public immutable boundChainId;
  address public immutable owner;

  /// @notice Which native record this token represents: the commitment the
  /// decoded record must hash to. A newer revision is a different record, so
  /// this has to be advanced deliberately rather than matching any revision.
  ///
  /// Advancing it is a trust point and it is a weak one: the new commitment
  /// still has to equal the hash of a record decoded out of a trie proof under
  /// the feed's current root. The owner can choose WHICH real native record
  /// this token follows; they cannot invent one.
  bytes32 public titleCommitment;

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
  error RecipientNotProven(address proven, address claimed);

  constructor(
    ITitleVerifier verifier_,
    IRootFeed feed_,
    bytes32 titleId_,
    bytes32 titleCommitment_,
    address owner_
  ) {
    if (address(verifier_) == address(0) || address(feed_) == address(0) || owner_ == address(0)) revert ZeroAddress();
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

  /// @notice Adopt the commitment of a newer revision of this title.
  /// @dev Does not relax any check: the next proof must still prove a record
  /// that hashes to the new commitment, at the feed's current root, at a
  /// revision at or above the accepted one.
  function setTitleCommitment(bytes32 next) external onlyOwner {
    if (next == bytes32(0)) revert ZeroAddress();
    emit TitleCommitmentChanged(titleCommitment, next);
    titleCommitment = next;
  }

  /// @notice Halt every gated operation. There is no path that un-gates a
  /// transfer by pausing: paused means refuse.
  function setPaused(bool next) external onlyOwner {
    paused = next;
    emit PausedChanged(next);
  }

  /// @dev Run every binding check, consume the nullifier, and hand back the
  /// decoded native record. Reverts on anything less than a fully bound,
  /// current, unreplayed proof.
  function _gate(uint8 operation, bytes32 actionHash, ITitleVerifier.TitleProof calldata proof)
    internal
    returns (TitleRecord memory record)
  {
    if (paused) revert GateIsPaused();

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

    bytes32 nullifier =
      keccak256(abi.encode(titleId, proof.revision, operation, actionHash, address(this)));
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
