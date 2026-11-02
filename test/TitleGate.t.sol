// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { TitleRecord, TitleLib } from "lemo/LemoTitle.sol";
import { ITitleVerifier } from "lemo/ITitleVerifier.sol";
import { SubstrateTrieVerifier } from "lemo/SubstrateTrieVerifier.sol";
import { RootFeed } from "lemo/RootFeed.sol";
import { TitleGateBase } from "lemo/TitleGateBase.sol";
import { TitleGateERC20 } from "lemo/TitleGateERC20.sol";
import { TitleGateERC721 } from "lemo/TitleGateERC721.sol";
import { TestBlake2b } from "./harness/TestBlake2b.sol";
import { TitleProofBuilder } from "./harness/TitleProofBuilder.sol";
import { MockTitleVerifier } from "./harness/MockTitleVerifier.sol";

/// @title TitleGateTest
/// @notice Token rules, isolated from proof math, plus one end to end path
/// through the real verifier and a real trie.
///
/// The rule table uses MockTitleVerifier: the gate's job is to bind and refuse,
/// and every case below is a refusal the gate itself owns. The end to end case
/// uses SubstrateTrieVerifier with the pure Solidity blake2b and a genuinely
/// hashed two node proof, so the same transfer is also proven to work when the
/// verdict comes from real proof math.
contract TitleGateTest is Test {
  uint8 internal constant OP_TRANSFER = 1;
  uint8 internal constant OP_MINT = 2;
  uint8 internal constant OP_BURN = 3;

  address internal constant ATTESTER = address(0xA77E57);
  address internal constant ALICE = address(0xA11CE);
  address internal constant BOB = address(0xB0B);
  address internal constant STRANGER = address(0x5712A);

  bytes32 internal constant TITLE_ID = keccak256("LEMO.TITLE.TEST.1");
  bytes32 internal constant NATIVE_ASSET = keccak256("POT.native");
  bytes32 internal constant BACKING = keccak256("LEMO.BACKING.TEST.1");
  bytes32 internal constant IDENTITY = keccak256("LEMO.IDENTITY.TEST.1");
  bytes32 internal constant VESTING = keccak256("LEMO.VESTING.TEST.1");
  bytes32 internal constant PERMISSIONS = keccak256("LEMO.PERMISSIONS.TEST.1");

  TestBlake2b internal hasher;
  SubstrateTrieVerifier internal realVerifier;
  MockTitleVerifier internal mockVerifier;
  RootFeed internal feed;
  TitleProofBuilder internal builder;

  TitleGateERC20 internal token;
  TitleGateERC20 internal realToken;
  TitleGateERC721 internal nft;

  function setUp() public {
    vm.warp(1_700_000_000);

    hasher = new TestBlake2b();
    realVerifier = new SubstrateTrieVerifier(hasher);
    mockVerifier = new MockTitleVerifier();
    feed = new RootFeed(ATTESTER);
    builder = new TitleProofBuilder(hasher);

    // A token's record names the token, so the address has to exist before
    // the record is hashed. Predict it, then prove the prediction.
    address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
    TitleRecord memory base = _record(1, BACKING, IDENTITY, predicted);
    token = new TitleGateERC20(
      mockVerifier, feed, TITLE_ID, TitleLib.hash(base), address(this), "LEMO Title 1", "LT1", 1_000_000e18
    );
    assertEq(address(token), predicted, "predicted address mismatch");
    mockVerifier.set(ITitleVerifier.Status.PROVEN, base);

    address predictedReal = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
    TitleRecord memory realBase = _record(1, BACKING, IDENTITY, predictedReal);
    realToken = new TitleGateERC20(
      realVerifier, feed, TITLE_ID, TitleLib.hash(realBase), address(this), "LEMO Title 1", "LT1", 1_000_000e18
    );
    assertEq(address(realToken), predictedReal, "predicted address mismatch (real)");

    address predictedNft = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
    TitleRecord memory nftBase = _record(1, BACKING, IDENTITY, predictedNft);
    nft = new TitleGateERC721(
      mockVerifier, feed, TITLE_ID, TitleLib.hash(nftBase), address(this), "LEMO Title 1", "LT1"
    );
    assertEq(address(nft), predictedNft, "predicted address mismatch (nft)");
  }

  // ------------------------------------------------------ the happy paths

  /// @notice The one end to end path: real verifier, real blake2b, real trie,
  /// real root. Mint, then a gated transfer at the next revision.
  function test_GatedTransferWithRealProof() public {
    TitleRecord memory rev1 = _record(1, BACKING, IDENTITY, address(realToken));
    (ITitleVerifier.TitleProof memory mintProof, bytes32 root1,) =
      builder.proofFor(rev1, OP_MINT, address(realToken));

    vm.prank(ATTESTER);
    feed.attest(root1, 292_815);

    assertEq(realToken.balanceOf(ALICE), 0);
    vm.prank(ALICE);
    realToken.mint(ALICE, 100, mintProof);
    assertEq(realToken.balanceOf(ALICE), 100, "mint with a real proof");

    TitleRecord memory rev2 = _record(2, BACKING, IDENTITY, address(realToken));
    realToken.setTitleCommitment(TitleLib.hash(rev2));
    (ITitleVerifier.TitleProof memory transferProof, bytes32 root2,) =
      builder.proofFor(rev2, OP_TRANSFER, address(realToken));

    vm.prank(ATTESTER);
    feed.attest(root2, 292_816);

    vm.prank(ALICE);
    realToken.transfer(BOB, 40, transferProof);

    assertEq(realToken.balanceOf(ALICE), 60, "sender balance after gated transfer");
    assertEq(realToken.balanceOf(BOB), 40, "recipient balance after gated transfer");
    assertEq(realToken.acceptedRevision(), 2, "accepted revision advanced");
  }

  /// @notice The same gate on a unique representation.
  function test_GatedERC721Transfer() public {
    TitleRecord memory rev1 = _record(1, BACKING, IDENTITY, address(nft));
    _adoptNft(rev1, ITitleVerifier.Status.PROVEN);
    (ITitleVerifier.TitleProof memory mintProof, bytes32 root1,) =
      builder.proofFor(rev1, OP_MINT, address(nft));

    vm.prank(ATTESTER);
    feed.attest(root1, 1);

    nft.mint(ALICE, mintProof);
    assertEq(nft.ownerOf(1), ALICE);

    TitleRecord memory rev2 = _record(2, BACKING, IDENTITY, address(nft));
    _adoptNft(rev2, ITitleVerifier.Status.PROVEN);
    (ITitleVerifier.TitleProof memory transferProof, bytes32 root2,) =
      builder.proofFor(rev2, OP_TRANSFER, address(nft));

    vm.prank(ATTESTER);
    feed.attest(root2, 2);

    vm.prank(ALICE);
    nft.transferFrom(ALICE, BOB, 1, transferProof);
    assertEq(nft.ownerOf(1), BOB, "gated 721 transfer");
    assertTrue(nft.representationOutstanding(), "representation still outstanding");
  }

  // ---------------------------------------------------------- the six reverts

  /// @notice 1. The feed moved on, so a proof against the old root is stale.
  function test_RevertOnStaleRoot() public {
    _mintBase();

    TitleRecord memory rev2 = _record(2, BACKING, IDENTITY, address(token));
    _adopt(rev2, ITitleVerifier.Status.PROVEN);
    (ITitleVerifier.TitleProof memory transferProof, bytes32 root2,) =
      builder.proofFor(rev2, OP_TRANSFER, address(token));

    // The feed still holds revision 1's root. A reorg or a newer finalized
    // block is exactly this situation.
    vm.expectRevert(
      abi.encodeWithSelector(TitleGateBase.FeedRootMismatch.selector, root2, feed.currentRoot())
    );
    vm.prank(ALICE);
    token.transfer(BOB, 1, transferProof);
  }

  /// @notice 2. A proof at a revision the gate has already moved past.
  function test_RevertOnOldRevision() public {
    _mintBase();

    // A revision 1 transfer proof, built but never used while revision 1 was
    // current.
    TitleRecord memory rev1 = _record(1, BACKING, IDENTITY, address(token));
    _adopt(rev1, ITitleVerifier.Status.PROVEN);
    (ITitleVerifier.TitleProof memory oldProof, bytes32 oldRoot,) =
      builder.proofFor(rev1, OP_TRANSFER, address(token));
    oldProof.operation = OP_TRANSFER;

    _transferAt(2, 10);
    assertEq(token.acceptedRevision(), 2);

    // Re-publish the revision 1 root, so the root check passes and the
    // revision check is what has to refuse.
    vm.prank(ATTESTER);
    feed.attest(oldRoot, 1);

    vm.expectRevert(
      abi.encodeWithSelector(TitleGateBase.RevisionStale.selector, uint64(1), uint64(2))
    );
    vm.prank(ALICE);
    token.transfer(BOB, 1, oldProof);
  }

  /// @notice 3. Nothing native is bound, so there is nothing to represent.
  function test_RevertOnUnboundBacking() public {
    TitleRecord memory unbound = _record(1, bytes32(0), IDENTITY, address(token));
    _adopt(unbound, ITitleVerifier.Status.PROVEN);
    (ITitleVerifier.TitleProof memory proof, bytes32 root,) =
      builder.proofFor(unbound, OP_MINT, address(token));
    vm.prank(ATTESTER);
    feed.attest(root, 1);

    vm.expectRevert(TitleGateBase.BackingNotBound.selector);
    vm.prank(ALICE);
    token.mint(ALICE, 100, proof);
  }

  /// @notice 4. The native identity was cleared, so the title is not the same
  /// owner's any more.
  function test_RevertOnClearedIdentity() public {
    TitleRecord memory cleared = _record(1, BACKING, bytes32(0), address(token));
    _adopt(cleared, ITitleVerifier.Status.PROVEN);
    (ITitleVerifier.TitleProof memory proof, bytes32 root,) =
      builder.proofFor(cleared, OP_MINT, address(token));
    vm.prank(ATTESTER);
    feed.attest(root, 1);

    vm.expectRevert(TitleGateBase.IdentityCleared.selector);
    vm.prank(ALICE);
    token.mint(ALICE, 100, proof);
  }

  /// @notice 5. A proof aimed at another token contract.
  function test_RevertOnWrongTokenContract() public {
    _mintWithToken();

    TitleRecord memory rev2 = _record(2, BACKING, IDENTITY, address(token));
    _adopt(rev2, ITitleVerifier.Status.PROVEN);
    (ITitleVerifier.TitleProof memory proof, bytes32 root,) =
      builder.proofFor(rev2, OP_TRANSFER, address(nft));
    vm.prank(ATTESTER);
    feed.attest(root, 2);

    vm.expectRevert(abi.encodeWithSelector(TitleGateBase.TokenMismatch.selector, address(nft)));
    vm.prank(ALICE);
    token.transfer(BOB, 1, proof);
  }

  /// @notice 6. The same proof cannot authorise a second state change.
  function test_RevertOnReplayedProof() public {
    _mintBase();

    TitleRecord memory rev2 = _record(2, BACKING, IDENTITY, address(token));
    _adopt(rev2, ITitleVerifier.Status.PROVEN);
    (ITitleVerifier.TitleProof memory proof, bytes32 root,) =
      builder.proofFor(rev2, OP_TRANSFER, address(token));
    vm.prank(ATTESTER);
    feed.attest(root, 2);

    vm.prank(ALICE);
    token.transfer(BOB, 5, proof);
    assertEq(token.balanceOf(BOB), 5);

    bytes32 nullifier = keccak256(
      abi.encode(
        TITLE_ID, uint64(2), OP_TRANSFER, keccak256(abi.encode(BOB, uint256(5))), address(token)
      )
    );
    vm.expectRevert(abi.encodeWithSelector(TitleGateBase.ProofReplayed.selector, nullifier));
    vm.prank(ALICE);
    token.transfer(BOB, 5, proof);

    assertEq(token.balanceOf(BOB), 5, "a replayed proof moved nothing");
  }

  // --------------------------------------------------------- other refusals

  function test_RevertWhenFeedHasNoRoot() public {
    RootFeed empty = new RootFeed(ATTESTER);
    TitleRecord memory record = _record(1, BACKING, IDENTITY, address(this));
    TitleGateERC20 other = new TitleGateERC20(
      mockVerifier, empty, TITLE_ID, TitleLib.hash(record), address(this), "T", "T", 1_000_000e18
    );
    mockVerifier.set(ITitleVerifier.Status.PROVEN, record);
    (ITitleVerifier.TitleProof memory proof, bytes32 root,) =
      builder.proofFor(record, OP_MINT, address(other));
    proof.stateRoot = root;

    vm.expectRevert(TitleGateBase.FeedHasNoRoot.selector);
    other.mint(ALICE, 1, proof);
  }

  function test_RevertOnVerifierVerdictThatIsNotProven() public {
    _mintBase();
    TitleRecord memory rev2 = _record(2, BACKING, IDENTITY, address(token));
    _adopt(rev2, ITitleVerifier.Status.ABSENT);
    (ITitleVerifier.TitleProof memory proof, bytes32 root,) =
      builder.proofFor(rev2, OP_TRANSFER, address(token));
    vm.prank(ATTESTER);
    feed.attest(root, 2);

    vm.expectRevert(
      abi.encodeWithSelector(
        TitleGateBase.ProofRejected.selector, uint8(ITitleVerifier.Status.ABSENT)
      )
    );
    vm.prank(ALICE);
    token.transfer(BOB, 1, proof);
  }

  function test_RevertOnWrongChainId() public {
    _mintBase();
    TitleRecord memory rev2 = _record(2, BACKING, IDENTITY, address(token));
    _adopt(rev2, ITitleVerifier.Status.PROVEN);
    (ITitleVerifier.TitleProof memory proof, bytes32 root,) =
      builder.proofFor(rev2, OP_TRANSFER, address(token));
    proof.chainId = 1;
    vm.prank(ATTESTER);
    feed.attest(root, 2);

    vm.expectRevert(
      abi.encodeWithSelector(TitleGateBase.ChainMismatch.selector, uint256(1), block.chainid)
    );
    vm.prank(ALICE);
    token.transfer(BOB, 1, proof);
  }

  function test_RevertOnWrongOperation() public {
    _mintWithToken();
    TitleRecord memory rev2 = _record(2, BACKING, IDENTITY, address(token));
    _adopt(rev2, ITitleVerifier.Status.PROVEN);
    (ITitleVerifier.TitleProof memory proof, bytes32 root,) =
      builder.proofFor(rev2, OP_MINT, address(token));
    vm.prank(ATTESTER);
    feed.attest(root, 2);

    vm.expectRevert(
      abi.encodeWithSelector(TitleGateBase.OperationMismatch.selector, OP_MINT, OP_TRANSFER)
    );
    vm.prank(ALICE);
    token.transfer(BOB, 1, proof);
  }

  function test_RevertTitlesIdMismatch() public {
    _mintWithToken();
    TitleRecord memory rev2 = _record(2, BACKING, IDENTITY, address(token));
    _adopt(rev2, ITitleVerifier.Status.PROVEN);
    (ITitleVerifier.TitleProof memory proof, bytes32 root,) =
      builder.proofFor(rev2, OP_TRANSFER, address(token));
    proof.titleId = keccak256("another title");
    vm.prank(ATTESTER);
    feed.attest(root, 2);

    vm.expectRevert(
      abi.encodeWithSelector(TitleGateBase.TitleIdMismatch.selector, keccak256("another title"))
    );
    vm.prank(ALICE);
    token.transfer(BOB, 1, proof);
  }

  function test_RevertWhenPaused() public {
    _mintBase();
    token.setPaused(true);
    TitleRecord memory rev2 = _record(2, BACKING, IDENTITY, address(token));
    _adopt(rev2, ITitleVerifier.Status.PROVEN);
    (ITitleVerifier.TitleProof memory proof,,) = builder.proofFor(rev2, OP_TRANSFER, address(token));

    vm.expectRevert(TitleGateBase.GateIsPaused.selector);
    vm.prank(ALICE);
    token.transfer(BOB, 1, proof);
  }

  function test_TransferToSelfIsRefusedBeforeConsumingTheProof() public {
    _mintBase();
    TitleRecord memory rev2 = _record(2, BACKING, IDENTITY, address(token));
    _adopt(rev2, ITitleVerifier.Status.PROVEN);
    (ITitleVerifier.TitleProof memory proof, bytes32 root,) =
      builder.proofFor(rev2, OP_TRANSFER, address(token));
    vm.prank(ATTESTER);
    feed.attest(root, 2);

    vm.expectRevert(TitleGateBase.SameOwnerAndRecipient.selector);
    vm.prank(ALICE);
    token.transfer(ALICE, 1, proof);

    // The authorisation was not consumed by the refused call.
    vm.prank(ALICE);
    token.transfer(BOB, 1, proof);
    assertEq(token.balanceOf(BOB), 1);
  }

  /// @notice The gate's anchor is the hash of the record, so a token aimed at
  /// a different record cannot be made to accept this one.
  function test_TokenAnchorIsTheRecordCommitment() public view {
    TitleRecord memory record = _record(1, BACKING, IDENTITY, address(token));
    assertEq(token.titleCommitment(), TitleLib.hash(record));
    assertTrue(
      token.titleCommitment() != TitleLib.hash(_record(2, BACKING, IDENTITY, address(token))),
      "a revision bump must change the anchor"
    );
  }

  function test_ApproveDoesNotMoveAnything() public {
    _mintBase();
    vm.prank(ALICE);
    token.approve(BOB, 50);
    assertEq(token.allowance(ALICE, BOB), 50);
    assertEq(token.balanceOf(BOB), 0, "approval must not move a balance");

    // Spending the approval still needs a proof of its own.
    TitleRecord memory rev2 = _record(2, BACKING, IDENTITY, address(token));
    _adopt(rev2, ITitleVerifier.Status.PROVEN);
    (ITitleVerifier.TitleProof memory proof, bytes32 root,) =
      builder.proofFor(rev2, OP_TRANSFER, address(token));
    vm.prank(ATTESTER);
    feed.attest(root, 2);

    vm.prank(BOB);
    token.transferFrom(ALICE, BOB, 50, proof);
    assertEq(token.balanceOf(BOB), 50);
    assertEq(token.allowance(ALICE, BOB), 0);
  }

  // ------------------------------------------------ supply and recipient fixes

  function test_MintCannotExceedTheCommittedSupplyCap() public {
    TitleRecord memory rev1 = _record(1, BACKING, IDENTITY, address(token));
    _adopt(rev1, ITitleVerifier.Status.PROVEN);
    (ITitleVerifier.TitleProof memory proof, bytes32 root,) =
      builder.proofFor(rev1, OP_MINT, address(token));
    vm.prank(ATTESTER);
    feed.attest(root, 1);

    vm.expectRevert(
      abi.encodeWithSelector(
        TitleGateERC20.SupplyCapExceeded.selector, 1_000_000e18, uint256(0), 1_000_001e18
      )
    );
    vm.prank(ALICE);
    token.mint(ALICE, 1_000_001e18, proof);
  }

  function test_MintIsBoundToTheProvenOwner() public {
    TitleRecord memory rev1 = _record(1, BACKING, IDENTITY, address(token));
    _adopt(rev1, ITitleVerifier.Status.PROVEN);
    (ITitleVerifier.TitleProof memory proof, bytes32 root,) =
      builder.proofFor(rev1, OP_MINT, address(token));
    vm.prank(ATTESTER);
    feed.attest(root, 1);

    vm.expectRevert(
      abi.encodeWithSelector(TitleGateBase.RecipientNotProven.selector, ALICE, BOB)
    );
    vm.prank(BOB);
    token.mint(BOB, 1, proof);
  }

  function test_BurnByAnOutsiderIsRefusedBeforeTheProof() public {
    (ITitleVerifier.TitleProof memory proof,) = _mintWithToken();
    vm.expectRevert(abi.encodeWithSelector(TitleGateERC20.NotAuthorised.selector, BOB, ALICE));
    vm.prank(BOB);
    token.burn(ALICE, 1, proof);
    assertEq(token.balanceOf(ALICE), 100, "outsider burn moved nothing");
  }

  // -------------------------------------------------------------- helpers

  function _record(uint64 revision, bytes32 backing, bytes32 identity, address evm)
    internal
    view
    returns (TitleRecord memory)
  {
    return TitleRecord({
      titleId: TITLE_ID,
      chainId: block.chainid,
      nativeAsset: NATIVE_ASSET,
      backing: backing,
      owner: ALICE,
      identityHash: identity,
      vestingHash: VESTING,
      permissionsHash: PERMISSIONS,
      evmContract: evm,
      revision: revision
    });
  }

  /// @dev Mint 100 to ALICE through the mock verifier; the feed is left on
  /// revision 1's root.
  function _mintBase() internal {
    _mintWithToken();
  }

  /// @dev Point the mock and the token at the same record.
  function _adopt(TitleRecord memory record, ITitleVerifier.Status status) internal {
    mockVerifier.set(status, record);
    token.setTitleCommitment(TitleLib.hash(record));
  }

  function _adoptNft(TitleRecord memory record, ITitleVerifier.Status status) internal {
    mockVerifier.set(status, record);
    nft.setTitleCommitment(TitleLib.hash(record));
  }

  function _mintWithToken() internal returns (ITitleVerifier.TitleProof memory, bytes32) {
    TitleRecord memory rev1 = _record(1, BACKING, IDENTITY, address(token));
    _adopt(rev1, ITitleVerifier.Status.PROVEN);
    (ITitleVerifier.TitleProof memory proof, bytes32 root,) =
      builder.proofFor(rev1, OP_MINT, address(token));
    vm.prank(ATTESTER);
    feed.attest(root, 1);
    vm.prank(ALICE);
    token.mint(ALICE, 100, proof);
    return (proof, root);
  }

  function _transferAt(uint64 revision, uint256 amount) internal {
    TitleRecord memory record = _record(revision, BACKING, IDENTITY, address(token));
    _adopt(record, ITitleVerifier.Status.PROVEN);
    (ITitleVerifier.TitleProof memory proof, bytes32 root,) =
      builder.proofFor(record, OP_TRANSFER, address(token));
    vm.prank(ATTESTER);
    feed.attest(root, revision);
    vm.prank(ALICE);
    token.transfer(BOB, amount, proof);
  }
}
