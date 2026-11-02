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
///   requestUnbond   needs the native proof of the title (operation 4, the burn
///                   operation is what authorises a release) and refuses while
///                   the representation still exists. Records a pending request
///                   and spends the proof's nullifier.
///   completeUnbond  the unlock. Attester only, and only for a pending request.
///
/// The failure worth designing for is an interruption between the two: a
/// pending request whose unlock never lands. It cannot be re-requested with the
/// same proof (the nullifier is spent), it cannot be completed by anyone else,
/// and the representation cannot be re-minted with the proof the burn consumed.
/// Nothing doubles and nothing is released early; the request waits.
contract UnbondGuard {
  uint8 public constant OP_UNBOND = 4;
  uint8 public constant REQUIRED_PROOF_OPERATION = 3; // burn

  ITitleVerifier public immutable verifier;
  IRootFeed public immutable feed;
  IRepresentation public immutable representation;
  bytes32 public immutable titleId;
  address public immutable attester;

  enum State {
    NONE,
    PENDING,
    RELEASED
  }

  mapping(bytes32 => State) public requestState;
  mapping(bytes32 => bool) public nullifierUsed;
  mapping(bytes32 => uint256) public requestBlock;
  mapping(bytes32 => bytes32) public openRequest;

  event UnbondRequested(
    bytes32 indexed id, bytes32 stateRoot, uint64 revision, uint256 blockNumber
  );
  event UnbondReleased(bytes32 indexed id);

  error RepresentationOutstanding();
  error NotAttester();
  error ProofRejected(uint8 status);
  error FeedRootMismatch(bytes32 proven, bytes32 accepted);
  error OperationMismatch(uint8 claimed);
  error TokenMismatch(address claimed);
  error TitleMismatch(bytes32 claimed);
  error ChainMismatch(uint256 claimed);
  error ProofReplayed(bytes32 nullifier);
  error RequestNotPending(bytes32 id);
  error RequestAlreadyOpen(bytes32 titleId, bytes32 id);
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
  /// still holds anything.
  function requestUnbond(ITitleVerifier.TitleProof calldata proof) external returns (bytes32 id) {
    if (representation.representationOutstanding()) revert RepresentationOutstanding();

    bytes32 accepted = feed.currentRoot();
    if (proof.stateRoot != accepted) revert FeedRootMismatch(proof.stateRoot, accepted);
    if (proof.chainId != block.chainid) revert ChainMismatch(proof.chainId);
    if (proof.operation != REQUIRED_PROOF_OPERATION) revert OperationMismatch(proof.operation);
    if (proof.token != address(representation)) revert TokenMismatch(proof.token);
    if (proof.titleId != titleId) revert TitleMismatch(proof.titleId);

    (ITitleVerifier.Status status, TitleRecord memory record) =
      verifier.verifyTitle(proof, representation.titleCommitment());
    if (status != ITitleVerifier.Status.PROVEN) revert ProofRejected(uint8(status));
    if (record.backing == bytes32(0)) revert RecordNotBacked();

    bytes32 nullifier = keccak256(
      abi.encode(titleId, proof.revision, OP_UNBOND, proof.stateRoot, address(representation))
    );
    if (nullifierUsed[nullifier]) revert ProofReplayed(nullifier);
    nullifierUsed[nullifier] = true;

    id = keccak256(abi.encode(titleId, proof.revision, OP_UNBOND, proof.stateRoot));
    if (openRequest[titleId] != bytes32(0)) revert RequestAlreadyOpen(titleId, openRequest[titleId]);
    openRequest[titleId] = id;
    requestState[id] = State.PENDING;
    requestBlock[id] = block.number;

    emit UnbondRequested(id, proof.stateRoot, proof.revision, block.number);
  }

  /// @notice The unlock. Only the attester, and only for a pending request.
  function completeUnbond(bytes32 id) external {
    if (msg.sender != attester) revert NotAttester();
    if (requestState[id] != State.PENDING) revert RequestNotPending(id);
    if (representation.representationOutstanding()) revert RepresentationOutstanding();
    requestState[id] = State.RELEASED;
    if (openRequest[titleId] == id) delete openRequest[titleId];
    emit UnbondReleased(id);
  }
}
