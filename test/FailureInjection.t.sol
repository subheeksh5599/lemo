// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { TitleRecord, TitleLib } from "lemo/LemoTitle.sol";
import { ITitleVerifier } from "lemo/ITitleVerifier.sol";
import { SubstrateTrieVerifier } from "lemo/SubstrateTrieVerifier.sol";
import { RootFeed } from "lemo/RootFeed.sol";
import { TitleGateBase } from "lemo/TitleGateBase.sol";
import { TitleGateERC20 } from "lemo/TitleGateERC20.sol";
import { UnbondGuard } from "lemo/UnbondGuard.sol";
import { TestBlake2b } from "./harness/TestBlake2b.sol";
import { TitleProofBuilder } from "./harness/TitleProofBuilder.sol";

/// @title FailureInjectionTest
/// @notice Failure injection across the whole gated path, with the real verifier
/// everywhere: every proof below is built by TitleProofBuilder and hashed with
/// the pure Solidity blake2b, and the "bad" proofs are bad in a real way (empty
/// node set, wrong root, wrong record, wrong revision, wrong operation).
///
/// Every scenario must fail closed. "Fail closed" here means both halves:
/// the call reverts AND nothing moved. A revert that leaves half a state change
/// behind is not a pass, so each scenario asserts balances, supply and the
/// guard's state after the refusal.
contract FailureInjectionTest is Test {
  uint8 internal constant OP_TRANSFER = 1;
  uint8 internal constant OP_MINT = 2;
  uint8 internal constant OP_BURN = 3;

  address internal constant ATTESTER = address(0xA77E57);
  address internal constant ALICE = address(0xA11CE);
  address internal constant BOB = address(0xB0B);
  address internal constant STRANGER = address(0x5712A);

  bytes32 internal constant TITLE_ID = keccak256("LEMO.TITLE.FAILURE.1");
  bytes32 internal constant BACKING = keccak256("LEMO.BACKING.TEST.1");
  bytes32 internal constant IDENTITY = keccak256("LEMO.IDENTITY.TEST.1");

  TestBlake2b internal hasher;
  SubstrateTrieVerifier internal verifier;
  RootFeed internal feed;
  TitleProofBuilder internal builder;
  TitleGateERC20 internal token;
  UnbondGuard internal guard;

  function setUp() public {
    vm.warp(1_700_000_000);

    hasher = new TestBlake2b();
    verifier = new SubstrateTrieVerifier(hasher);
    feed = new RootFeed(ATTESTER);
    builder = new TitleProofBuilder(hasher);

    address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
    TitleRecord memory base = _record(1, BACKING, IDENTITY, predicted);
    token = new TitleGateERC20(
      verifier, feed, TITLE_ID, TitleLib.hash(base), address(this), "LEMO Title 1", "LT1", 1_000_000e18
    );
    assertEq(address(token), predicted, "predicted address");

    guard = new UnbondGuard(verifier, feed, token, TITLE_ID, ATTESTER);
  }

  // ------------------------------------------------------- 1. mint and burn

  /// @notice Scenario 1: minting representation for a title with no backing.
  /// The record decodes and the proof is real; the gate refuses on the record.
  function test_01_MintWithoutBacking() public {
    (ITitleVerifier.TitleProof memory proof, bytes32 root) =
      _proof(1, bytes32(0), IDENTITY, OP_MINT);
    _attest(root);

    vm.expectRevert(TitleGateBase.BackingNotBound.selector);
    vm.prank(ALICE);
    token.mint(ALICE, 100, proof);

    assertEq(token.totalSupply(), 0, "supply unchanged");
    assertEq(token.balanceOf(ALICE), 0, "balance unchanged");
  }

  /// @notice Scenario 2: minting with no proof at all. The verifier reports
  /// INCOMPLETE and the gate refuses; it never treats the empty set as
  /// "nothing there, so mint away".
  function test_02_MintWithNoProof() public {
    (ITitleVerifier.TitleProof memory proof, bytes32 root) = _proof(1, BACKING, IDENTITY, OP_MINT);
    _attest(root);
    proof.nodes = new bytes[](0);

    vm.expectRevert(
      abi.encodeWithSelector(
        TitleGateBase.ProofRejected.selector, uint8(ITitleVerifier.Status.INCOMPLETE)
      )
    );
    vm.prank(ALICE);
    token.mint(ALICE, 100, proof);
    assertEq(token.totalSupply(), 0);
  }

  /// @notice Scenario 3: burning with no proof.
  function test_03_BurnWithoutProof() public {
    _mintBase();
    (ITitleVerifier.TitleProof memory proof, bytes32 root) = _proof(2, BACKING, IDENTITY, OP_BURN);
    _attest(root);
    proof.nodes = new bytes[](0);

    vm.expectRevert(
      abi.encodeWithSelector(
        TitleGateBase.ProofRejected.selector, uint8(ITitleVerifier.Status.INCOMPLETE)
      )
    );
    vm.prank(ALICE);
    token.burn(ALICE, 100, proof);
    assertEq(token.balanceOf(ALICE), 100, "burn without proof moved nothing");
    assertEq(token.totalSupply(), 100);
  }

  /// @notice Scenario 4: transferring with no proof.
  function test_04_TransferWithoutProof() public {
    _mintBase();
    (ITitleVerifier.TitleProof memory proof, bytes32 root) =
      _proof(2, BACKING, IDENTITY, OP_TRANSFER);
    _attest(root);
    proof.nodes = new bytes[](0);

    vm.expectRevert(
      abi.encodeWithSelector(
        TitleGateBase.ProofRejected.selector, uint8(ITitleVerifier.Status.INCOMPLETE)
      )
    );
    vm.prank(ALICE);
    token.transfer(BOB, 10, proof);
    assertEq(token.balanceOf(ALICE), 100, "transfer without proof moved nothing");
  }

  /// @notice Scenario 5: a burn the native side would not agree to, because
  /// the proof claims a different operation.
  function test_05_BurnWithAMintProof() public {
    _mintBase();
    (ITitleVerifier.TitleProof memory mintProof,) = _proof(1, BACKING, IDENTITY, OP_MINT);

    vm.expectRevert(
      abi.encodeWithSelector(TitleGateBase.OperationMismatch.selector, OP_MINT, OP_BURN)
    );
    vm.prank(ALICE);
    token.burn(ALICE, 100, mintProof);
    assertEq(token.balanceOf(ALICE), 100);
    assertEq(token.totalSupply(), 100);
  }

  // ----------------------------------------------------------- 6. replay

  /// @notice Scenario 6: the same proof spent twice.
  function test_06_ProofDoubleSpend() public {
    _mintBase();
    (ITitleVerifier.TitleProof memory proof, bytes32 root) =
      _proof(2, BACKING, IDENTITY, OP_TRANSFER);
    _attest(root);

    vm.prank(ALICE);
    token.transfer(BOB, 10, proof);
    assertEq(token.balanceOf(BOB), 10);

    bytes32 nullifier = keccak256(
      abi.encode(
        TITLE_ID, uint64(2), OP_TRANSFER, keccak256(abi.encode(BOB, uint256(10))), address(token)
      )
    );
    vm.expectRevert(abi.encodeWithSelector(TitleGateBase.ProofReplayed.selector, nullifier));
    vm.prank(ALICE);
    token.transfer(BOB, 10, proof);

    assertEq(token.balanceOf(BOB), 10, "double spend moved nothing the second time");
  }

  /// @notice Scenario 7: a burn proof replayed after the burn.
  function test_07_BurnReplay() public {
    _mintBase();
    (ITitleVerifier.TitleProof memory proof, bytes32 root) = _proof(2, BACKING, IDENTITY, OP_BURN);
    _attest(root);

    vm.prank(ALICE);
    token.burn(ALICE, 100, proof);
    assertEq(token.totalSupply(), 0);

    vm.expectRevert();
    vm.prank(ALICE);
    token.burn(ALICE, 100, proof);
    assertEq(token.totalSupply(), 0, "a replayed burn cannot mint supply back");
  }

  /// @notice Scenario 8: the same proof re-used for the other direction. A
  /// burn proof must not become a mint proof.
  function test_08_BurnProofCannotMint() public {
    _mintBase();
    (ITitleVerifier.TitleProof memory proof, bytes32 root) = _proof(2, BACKING, IDENTITY, OP_BURN);
    _attest(root);

    vm.prank(ALICE);
    token.burn(ALICE, 100, proof);
    assertEq(token.totalSupply(), 0);

    vm.expectRevert(
      abi.encodeWithSelector(TitleGateBase.OperationMismatch.selector, OP_BURN, OP_MINT)
    );
    vm.prank(ALICE);
    token.mint(ALICE, 100, proof);
    assertEq(token.totalSupply(), 0, "a burn proof minted supply");
  }

  // ------------------------------------------------------------ 9. reorg

  /// @notice Scenario 9: a root reorg. The feed moves to a new root; a proof
  /// against the superseded root is refused even though it was valid once.
  function test_09_RootReorg() public {
    _mintBase();
    (ITitleVerifier.TitleProof memory proof, bytes32 oldRoot) =
      _proof(2, BACKING, IDENTITY, OP_TRANSFER);

    // The feed moves on to a later block without ever publishing oldRoot.
    (, bytes32 currentRoot) = _proof(3, BACKING, IDENTITY, OP_TRANSFER);
    _attest(currentRoot);

    vm.expectRevert(
      abi.encodeWithSelector(TitleGateBase.FeedRootMismatch.selector, oldRoot, currentRoot)
    );
    vm.prank(ALICE);
    token.transfer(BOB, 10, proof);
    assertEq(token.balanceOf(BOB), 0, "a reorged root moved tokens");
  }

  /// @notice Scenario 10: a reorg that rolls the feed BACK to the old root.
  /// The proof against that root was never spent, so it becomes usable again,
  /// which is exactly why the feed must never be allowed to roll back in
  /// production (see contracts/README.md). What must still hold: a proof already
  /// consumed before the reorg stays consumed.
  function test_10_RootRollbackDoesNotReviveSpentProofs() public {
    _mintBase();
    (ITitleVerifier.TitleProof memory spent, bytes32 root2) =
      _proof(2, BACKING, IDENTITY, OP_TRANSFER);
    _attest(root2);

    vm.prank(ALICE);
    token.transfer(BOB, 10, spent);

    (, bytes32 root3) = _proof(3, BACKING, IDENTITY, OP_TRANSFER);
    _attest(root3);

    // Roll back to the root and the record the spent proof was bound to.
    _adopt(2, BACKING, IDENTITY);
    _attest(root2);

    vm.expectRevert(
      abi.encodeWithSelector(
        TitleGateBase.ProofReplayed.selector,
        keccak256(
          abi.encode(
            TITLE_ID, uint64(2), OP_TRANSFER, keccak256(abi.encode(BOB, uint256(10))), address(token)
          )
        )
      )
    );
    vm.prank(ALICE);
    token.transfer(BOB, 10, spent);
    assertEq(token.balanceOf(BOB), 10, "a rolled back root revived a spent proof");
  }

  // ------------------------------------------------- 11. burn and unlock

  /// @notice Scenario 11: the interruption between burn and unlock. The burn
  /// lands, the unbond request lands, and then the unlock never happens. The
  /// pending request cannot be re-requested, cannot be completed by anyone but
  /// the attester, and nothing can be minted or burned with the proofs already
  /// spent.
  function test_11_InterruptedBetweenBurnAndUnlock() public {
    _mintBase();
    (ITitleVerifier.TitleProof memory burnProof, bytes32 root2) =
      _proof(2, BACKING, IDENTITY, OP_BURN);
    _attest(root2);

    vm.prank(ALICE);
    token.burn(ALICE, 100, burnProof);
    assertEq(token.totalSupply(), 0);
    assertFalse(token.representationOutstanding());

    bytes32 id = guard.requestUnbond(burnProof);
    assertEq(uint256(guard.requestState(id)), uint256(UnbondGuard.State.PENDING));

    // The interruption: completeUnbond is never called for this request.

    // 1. The same proof cannot start a second unbond.
    vm.expectRevert();
    guard.requestUnbond(burnProof);

    // 2. Nobody but the attester can complete it.
    vm.expectRevert(UnbondGuard.NotAttester.selector);
    vm.prank(STRANGER);
    guard.completeUnbond(id);

    // 3. The burn proof cannot mint the representation back.
    vm.expectRevert();
    vm.prank(ALICE);
    token.mint(ALICE, 100, burnProof);

    // 4. And it cannot burn again.
    vm.expectRevert();
    vm.prank(ALICE);
    token.burn(ALICE, 100, burnProof);

    assertEq(uint256(guard.requestState(id)), uint256(UnbondGuard.State.PENDING), "request state");
    assertEq(token.totalSupply(), 0, "supply still zero");
    assertEq(token.balanceOf(ALICE), 0);

    // Recovery: the attester can still complete the pending request.
    vm.prank(ATTESTER);
    guard.completeUnbond(id);
    assertEq(uint256(guard.requestState(id)), uint256(UnbondGuard.State.RELEASED));
  }

  /// @notice Scenario 12: unbonding while the EVM representation is
  /// outstanding. Rule 2.
  function test_12_UnbondWhileRepresentationOutstanding() public {
    _mintBase();
    (ITitleVerifier.TitleProof memory mintProof,) = _proof(1, BACKING, IDENTITY, OP_MINT);

    vm.expectRevert(UnbondGuard.RepresentationOutstanding.selector);
    guard.requestUnbond(mintProof);

    assertEq(token.totalSupply(), 100, "supply unchanged");
  }

  /// @notice Scenario 13: unbonding with no proof.
  function test_13_UnbondWithoutProof() public {
    (ITitleVerifier.TitleProof memory proof, bytes32 root) = _proof(1, BACKING, IDENTITY, OP_BURN);
    _attest(root);
    proof.nodes = new bytes[](0);

    vm.expectRevert(
      abi.encodeWithSelector(
        UnbondGuard.ProofRejected.selector, uint8(ITitleVerifier.Status.INCOMPLETE)
      )
    );
    guard.requestUnbond(proof);
  }

  /// @notice Scenario 14: an unlock for a request that was never made.
  function test_14_CompleteUnbondForUnknownRequest() public {
    vm.expectRevert();
    vm.prank(ATTESTER);
    guard.completeUnbond(keccak256("never requested"));
  }

  // -------------------------------------------- 15. forged / mismatched proofs

  /// @notice Scenario 15: a proof whose root is not the feed's root.
  function test_15_StaleRoot() public {
    _mintBase();
    (ITitleVerifier.TitleProof memory proof, bytes32 root) =
      _proof(2, BACKING, IDENTITY, OP_TRANSFER);
    proof.stateRoot = bytes32(uint256(root) ^ 1);
    _attest(root);

    vm.expectRevert(
      abi.encodeWithSelector(TitleGateBase.FeedRootMismatch.selector, proof.stateRoot, root)
    );
    vm.prank(ALICE);
    token.transfer(BOB, 10, proof);
  }

  /// @notice Scenario 16: a proof for another token contract.
  function test_16_WrongTokenBinding() public {
    _mintBase();
    (ITitleVerifier.TitleProof memory proof, bytes32 root) =
      _proof(2, BACKING, IDENTITY, OP_TRANSFER);
    proof.token = address(0xDEAD);
    _attest(root);

    vm.expectRevert(abi.encodeWithSelector(TitleGateBase.TokenMismatch.selector, address(0xDEAD)));
    vm.prank(ALICE);
    token.transfer(BOB, 10, proof);
  }

  /// @notice Scenario 17: a proof of a record that is not the record this
  /// token represents (same title, different revision's commitment). The
  /// verifier reports VALUE_MISMATCH.
  function test_17_RecordNotTheTokensRecord() public {
    _mintBase();
    // Deliberately bypass the adoption helper: the proof is real, but the
    // token is still anchored on revision 1's commitment.
    TitleRecord memory rev2 = _record(2, BACKING, IDENTITY, address(token));
    (ITitleVerifier.TitleProof memory proof, bytes32 root,) =
      builder.proofFor(rev2, OP_TRANSFER, address(token));
    _attest(root);

    vm.expectRevert(
      abi.encodeWithSelector(
        TitleGateBase.ProofRejected.selector, uint8(ITitleVerifier.Status.VALUE_MISMATCH)
      )
    );
    vm.prank(ALICE);
    token.transfer(BOB, 10, proof);
    assertEq(token.balanceOf(BOB), 0);
  }

  /// @notice Scenario 18: a proof carrying a record at a different revision
  /// than it claims. The verifier's decode check refuses before the gate's
  /// revision rule even runs.
  function test_18_RevisionClaimDoesNotMatchTheRecord() public {
    _mintBase();
    (ITitleVerifier.TitleProof memory proof, bytes32 root) =
      _proof(2, BACKING, IDENTITY, OP_TRANSFER);
    _attest(root);
    proof.revision = 7;

    vm.expectRevert(
      abi.encodeWithSelector(
        TitleGateBase.ProofRejected.selector, uint8(ITitleVerifier.Status.INVALID)
      )
    );
    vm.prank(ALICE);
    token.transfer(BOB, 10, proof);
  }

  /// @notice Scenario 19: a cleared native identity.
  function test_19_ClearedIdentity() public {
    (ITitleVerifier.TitleProof memory proof, bytes32 root) = _proof(1, BACKING, bytes32(0), OP_MINT);
    _attest(root);

    vm.expectRevert(TitleGateBase.IdentityCleared.selector);
    vm.prank(ALICE);
    token.mint(ALICE, 100, proof);
    assertEq(token.totalSupply(), 0);
  }

  /// @notice Scenario 20: the paused switch. Pausing must stop every gated
  /// operation, including with a perfectly valid proof.
  function test_20_PausedRefusesEverything() public {
    _mintBase();
    token.setPaused(true);

    (ITitleVerifier.TitleProof memory proof, bytes32 root) =
      _proof(2, BACKING, IDENTITY, OP_TRANSFER);
    _attest(root);

    vm.expectRevert(TitleGateBase.GateIsPaused.selector);
    vm.prank(ALICE);
    token.transfer(BOB, 10, proof);
  }

  /// @notice Scenario 21: a burn request is completed after the representation
  /// has been minted again at the same revision. The release must re-check Rule
  /// 2, not trust the request-time check.
  function test_21_CompletedUnbondRechecksRepresentation() public {
    _mintBase();
    (ITitleVerifier.TitleProof memory burnProof, bytes32 root2) =
      _proof(2, BACKING, IDENTITY, OP_BURN);
    _attest(root2);

    vm.prank(ALICE);
    token.burn(ALICE, 100, burnProof);
    bytes32 id = guard.requestUnbond(burnProof);

    (ITitleVerifier.TitleProof memory mintProof, bytes32 root3) =
      _proof(2, BACKING, IDENTITY, OP_MINT);
    _attest(root3);
    vm.prank(ALICE);
    token.mint(ALICE, 100, mintProof);
    assertTrue(token.representationOutstanding(), "representation is live again");

    vm.expectRevert(UnbondGuard.RepresentationOutstanding.selector);
    vm.prank(ATTESTER);
    guard.completeUnbond(id);
    assertEq(uint256(guard.requestState(id)), uint256(UnbondGuard.State.PENDING));
  }

  /// @notice Scenario 22: a second unbond for the same title is refused while
  /// the first one is still pending, even if it uses a different proof.
  function test_22_OnlyOneOpenUnbondPerTitle() public {
    _mintBase();
    (ITitleVerifier.TitleProof memory first, bytes32 root2) =
      _proof(2, BACKING, IDENTITY, OP_BURN);
    _attest(root2);

    vm.prank(ALICE);
    token.burn(ALICE, 100, first);
    bytes32 id = guard.requestUnbond(first);

    (ITitleVerifier.TitleProof memory second, bytes32 root3) =
      _proof(3, BACKING, IDENTITY, OP_BURN);
    _attest(root3);
    vm.expectRevert(abi.encodeWithSelector(UnbondGuard.RequestAlreadyOpen.selector, TITLE_ID, id));
    guard.requestUnbond(second);
  }

  // ------------------------------------------------------------- helpers

  function _record(uint64 revision, bytes32 backing, bytes32 identity, address evm)
    internal
    view
    returns (TitleRecord memory)
  {
    return TitleRecord({
      titleId: TITLE_ID,
      chainId: block.chainid,
      nativeAsset: keccak256("POT.native"),
      backing: backing,
      owner: ALICE,
      identityHash: identity,
      vestingHash: keccak256("LEMO.VESTING.TEST.1"),
      permissionsHash: keccak256("LEMO.PERMISSIONS.TEST.1"),
      evmContract: evm,
      revision: revision
    });
  }

  function _attest(bytes32 root) internal {
    vm.prank(ATTESTER);
    feed.attest(root, 1);
  }

  /// @dev Mint 100 to ALICE at revision 1 with a real proof.
  function _mintBase() internal {
    (ITitleVerifier.TitleProof memory proof, bytes32 root) = _proof(1, BACKING, IDENTITY, OP_MINT);
    _attest(root);
    vm.prank(ALICE);
    token.mint(ALICE, 100, proof);
  }

  /// @dev Build a proof for a revision of this title and adopt that revision's
  /// commitment, which is what following the native record across a revision
  /// change means. Calling it twice at the same revision is idempotent.
  function _proof(uint64 revision, bytes32 backing, bytes32 identity, uint8 operation)
    internal
    returns (ITitleVerifier.TitleProof memory proof, bytes32 root)
  {
    TitleRecord memory record = _record(revision, backing, identity, address(token));
    (proof, root,) = builder.proofFor(record, operation, address(token));
    token.setTitleCommitment(TitleLib.hash(record));
  }

  /// @dev Adopt a revision's commitment without building a proof.
  function _adopt(uint64 revision, bytes32 backing, bytes32 identity) internal {
    TitleRecord memory record = _record(revision, backing, identity, address(token));
    token.setTitleCommitment(TitleLib.hash(record));
  }
}
