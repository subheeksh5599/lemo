// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ITitleVerifier } from "./ITitleVerifier.sol";
import { TitleRecord } from "./LemoTitle.sol";
import { IRootFeed } from "./IRootFeed.sol";
import { IRepresentation } from "./IRepresentation.sol";

/// @title UnbondGuard
/// @notice Rule 2 of the protocol on the EVM side: native unbonding is refused
/// while any EVM representation is outstanding.
///
/// An unbond is a two step handshake and the second step is the one that would
/// release value, so they are separated on purpose:
///
///   requestUnbond   needs a native proof of the title with the burn operation
///                   (OP_BURN: the burn is what authorises a release) and
///                   refuses while the representation still exists. Opens the
///                   title's single pending request.
///   completeUnbond  the unlock. Attester only, only for the open request, only
///                   while it has not expired, and only if the representation
///                   is STILL absent at release time.
///   cancelUnbond    the requester or the attester closes a pending request,
///                   which frees the title for a fresh request.
///
/// Invariants:
///   - at most one open request per title (one title per guard);
///   - a title is released at most once, ever (`released`);
///   - a request older than UNBOND_EXPIRY_BLOCKS cannot be released, only
///     cancelled, so an unlock cannot land against a long stale check.
///
/// The failure worth designing for is an interruption between the two steps: a
/// pending request whose unlock never lands. It blocks a second request, it
/// cannot be completed by anyone but the attester, it expires, and either side
/// can cancel it. Nothing doubles and nothing is released early.
contract UnbondGuard {
  /// @notice The proof operation that authorises an unbond: the burn.
  uint8 public constant OP_BURN = 3;

  /// @notice How many EVM blocks a request stays releasable.
  uint256 public constant UNBOND_EXPIRY_BLOCKS = 100_800;

  ITitleVerifier public immutable verifier;
  IRootFeed public immutable feed;
  IRepresentation public immutable representation;
  bytes32 public immutable titleId;
  address public immutable attester;

  enum State {
    NONE,
    PENDING,
    RELEASED,
    CANCELLED
  }

  struct Request {
    State state;
    uint64 revision;
    address requester;
    uint256 requestBlock;
    bytes32 stateRoot;
  }

  mapping(bytes32 => Request) public requests;
  bytes32 public openRequest;
  bool public released;
  uint256 public requestCount;

  event UnbondRequested(
    bytes32 indexed id,
    address indexed requester,
    bytes32 stateRoot,
    uint64 revision,
    uint256 blockNumber
  );
  event UnbondReleased(bytes32 indexed id);
  event UnbondCancelled(bytes32 indexed id, address indexed by);

  error RepresentationOutstanding();
  error NotAttester();
  error NotRequesterOrAttester();
  error ProofRejected(uint8 status);
  error FeedHasNoRoot();
  error FeedRootMismatch(bytes32 proven, bytes32 accepted);
  error OperationMismatch(uint8 claimed);
  error TokenMismatch(address claimed);
  error TitleMismatch(bytes32 claimed);
  error ChainMismatch(uint256 claimed);
  error RequestNotPending(bytes32 id);
  error RequestAlreadyOpen(bytes32 titleId, bytes32 id);
  error RequestExpired(bytes32 id, uint256 expiredAt);
  error AlreadyReleased();
  error RecordNotBacked();
  error ZeroAddress();

  constructor(
    ITitleVerifier verifier_,
    IRootFeed feed_,
    IRepresentation representation_,
    bytes32 titleId_,
    address attester_
  ) {
    if (address(verifier_) == address(0)) revert ZeroAddress();
    if (address(feed_) == address(0)) revert ZeroAddress();
    if (address(representation_) == address(0)) revert ZeroAddress();
    if (attester_ == address(0)) revert ZeroAddress();
    verifier = verifier_;
    feed = feed_;
    representation = representation_;
    titleId = titleId_;
    attester = attester_;
  }

  /// @notice Ask to unbond the native backing. Refused while the EVM side
  /// still holds anything, while another request is open, or once released.
  function requestUnbond(ITitleVerifier.TitleProof calldata proof) external returns (bytes32 id) {
    if (released) revert AlreadyReleased();
    if (openRequest != bytes32(0)) revert RequestAlreadyOpen(titleId, openRequest);
    if (representation.representationOutstanding()) revert RepresentationOutstanding();

    bytes32 accepted = feed.currentRoot();
    if (accepted == bytes32(0)) revert FeedHasNoRoot();
    if (proof.stateRoot != accepted) revert FeedRootMismatch(proof.stateRoot, accepted);
    if (proof.chainId != block.chainid) revert ChainMismatch(proof.chainId);
    if (proof.operation != OP_BURN) revert OperationMismatch(proof.operation);
    if (proof.token != address(representation)) revert TokenMismatch(proof.token);
    if (proof.titleId != titleId) revert TitleMismatch(proof.titleId);

    (ITitleVerifier.Status status, TitleRecord memory record) =
      verifier.verifyTitle(proof, representation.titleCommitment());
    if (status != ITitleVerifier.Status.PROVEN) revert ProofRejected(uint8(status));
    if (record.backing == bytes32(0)) revert RecordNotBacked();

    requestCount += 1;
    id = keccak256(abi.encode(titleId, proof.revision, proof.stateRoot, requestCount));
    openRequest = id;
    requests[id] = Request({
      state: State.PENDING,
      revision: proof.revision,
      requester: msg.sender,
      requestBlock: block.number,
      stateRoot: proof.stateRoot
    });

    emit UnbondRequested(id, msg.sender, proof.stateRoot, proof.revision, block.number);
  }

  /// @notice The unlock. Only the attester, only for the open request, only
  /// before it expires, and only while Rule 2 still holds.
  function completeUnbond(bytes32 id) external {
    if (msg.sender != attester) revert NotAttester();
    Request storage r = requests[id];
    if (r.state != State.PENDING) revert RequestNotPending(id);
    uint256 expiresAt = r.requestBlock + UNBOND_EXPIRY_BLOCKS;
    if (block.number > expiresAt) revert RequestExpired(id, expiresAt);
    if (representation.representationOutstanding()) revert RepresentationOutstanding();
    r.state = State.RELEASED;
    released = true;
    delete openRequest;
    emit UnbondReleased(id);
  }

  /// @notice Close a pending request (expired or not). The requester or the
  /// attester only.
  function cancelUnbond(bytes32 id) external {
    Request storage r = requests[id];
    if (r.state != State.PENDING) revert RequestNotPending(id);
    if (msg.sender != r.requester && msg.sender != attester) revert NotRequesterOrAttester();
    r.state = State.CANCELLED;
    delete openRequest;
    emit UnbondCancelled(id, msg.sender);
  }

  /// @notice A request's lifecycle state.
  function requestState(bytes32 id) external view returns (State) {
    return requests[id].state;
  }

  /// @notice The EVM block a request was opened at (its expiry anchor).
  function requestBlock(bytes32 id) external view returns (uint256) {
    return requests[id].requestBlock;
  }
}
