// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ThresholdRootFeed } from "lemo/ThresholdRootFeed.sol";

contract ThresholdRootFeedTest is Test {
  event Finalized(bytes32 indexed root, uint256 blockNumber, uint256 approvals);

  address internal constant A = address(0xA11CE);
  address internal constant B = address(0xB0B);
  address internal constant C = address(0xCA501);
  address internal constant OUTSIDER = address(0xBEEF);

  ThresholdRootFeed internal feed;

  function setUp() public {
    feed = new ThresholdRootFeed(_attesters(), 2);
  }

  function _attesters() internal pure returns (address[] memory attesters) {
    attesters = new address[](3);
    attesters[0] = A;
    attesters[1] = B;
    attesters[2] = C;
  }

  function test_ConstructorFixesQuorumAndSet() public view {
    assertEq(feed.threshold(), 2);
    assertEq(feed.attesterCount(), 3);
    assertTrue(feed.isAttester(A));
    assertTrue(feed.isAttester(B));
    assertTrue(feed.isAttester(C));
    assertFalse(feed.isAttester(OUTSIDER));
    assertFalse(feed.live());
  }

  function test_RejectsZeroThresholdAndThresholdAboveSet() public {
    vm.expectRevert(abi.encodeWithSelector(ThresholdRootFeed.ThresholdOutOfRange.selector, 0, 3));
    new ThresholdRootFeed(_attesters(), 0);

    vm.expectRevert(abi.encodeWithSelector(ThresholdRootFeed.ThresholdOutOfRange.selector, 4, 3));
    new ThresholdRootFeed(_attesters(), 4);
  }

  function test_RejectsDuplicateAndZeroAttester() public {
    address[] memory duplicate = new address[](2);
    duplicate[0] = A;
    duplicate[1] = A;
    vm.expectRevert(abi.encodeWithSelector(ThresholdRootFeed.DuplicateAttester.selector, A));
    new ThresholdRootFeed(duplicate, 1);

    address[] memory zero = new address[](1);
    vm.expectRevert(ThresholdRootFeed.ZeroAddress.selector);
    new ThresholdRootFeed(zero, 1);
  }

  function test_OneApprovalDoesNotMoveTheRoot() public {
    vm.prank(A);
    feed.attest(bytes32(uint256(1)), 10);

    assertFalse(feed.live());
    assertEq(feed.currentRoot(), bytes32(0));
    assertEq(feed.currentBlockNumber(), 0);
    assertEq(feed.approvals(keccak256(abi.encode(bytes32(uint256(1)), uint256(10)))), 1);
  }

  function test_QuorumFinalizesAndEmits() public {
    bytes32 root = keccak256("root");
    bytes32 proposal = keccak256(abi.encode(root, uint256(20)));

    vm.prank(A);
    feed.attest(root, 20);

    vm.expectEmit(true, false, false, true, address(feed));
    emit Finalized(root, 20, 2);
    vm.prank(B);
    feed.attest(root, 20);

    assertTrue(feed.live());
    assertEq(feed.currentRoot(), root);
    assertEq(feed.currentBlockNumber(), 20);
    assertEq(feed.approvals(proposal), 2);
  }

  function test_DuplicateApprovalReverts() public {
    bytes32 root = keccak256("root");

    vm.prank(A);
    feed.attest(root, 5);

    vm.prank(A);
    vm.expectRevert(ThresholdRootFeed.AlreadyApproved.selector);
    feed.attest(root, 5);
  }

  function test_OutsiderCannotApprove() public {
    vm.prank(OUTSIDER);
    vm.expectRevert(abi.encodeWithSelector(ThresholdRootFeed.NotAttester.selector, OUTSIDER));
    feed.attest(keccak256("root"), 5);
  }

  function test_ZeroRootReverts() public {
    vm.prank(A);
    vm.expectRevert(ThresholdRootFeed.ZeroRoot.selector);
    feed.attest(bytes32(0), 5);
  }

  function test_OlderBlockRevertsAfterFinalization() public {
    bytes32 root = keccak256("root");
    vm.prank(A);
    feed.attest(root, 10);
    vm.prank(B);
    feed.attest(root, 10);

    vm.prank(C);
    vm.expectRevert(abi.encodeWithSelector(ThresholdRootFeed.BlockNotNewer.selector, 9, 10));
    feed.attest(keccak256("older"), 9);
  }

  function test_CompetingRootCannotReplaceFinalizedOneAtSameBlock() public {
    bytes32 first = keccak256("first");
    vm.prank(A);
    feed.attest(first, 30);
    vm.prank(B);
    feed.attest(first, 30);

    vm.prank(C);
    vm.expectRevert(abi.encodeWithSelector(ThresholdRootFeed.BlockNotNewer.selector, 30, 30));
    feed.attest(keccak256("second"), 30);

    assertEq(feed.currentRoot(), first);
  }

  function test_SplitVotesDoNotFinalize() public {
    bytes32 first = keccak256("first");
    bytes32 second = keccak256("second");

    vm.prank(A);
    feed.attest(first, 40);
    vm.prank(B);
    feed.attest(second, 40);

    assertFalse(feed.live());

    vm.prank(C);
    feed.attest(first, 40);

    assertTrue(feed.live());
    assertEq(feed.currentRoot(), first);
  }

  function test_NewerQuorumAdvancesRoot() public {
    bytes32 first = keccak256("first");
    bytes32 second = keccak256("second");

    vm.prank(A);
    feed.attest(first, 50);
    vm.prank(B);
    feed.attest(first, 50);

    vm.prank(A);
    feed.attest(second, 51);
    vm.prank(C);
    feed.attest(second, 51);

    assertEq(feed.currentRoot(), second);
    assertEq(feed.currentBlockNumber(), 51);
  }

  // ------------------------------------------------------------------ M-02

  function test_QuorumIsTheThreshold() public view {
    assertEq(feed.quorum(), 2);
  }

  function test_RevokeWithdrawsAnApproval() public {
    bytes32 root = keccak256("mistake");
    bytes32 proposal = keccak256(abi.encode(root, uint256(60)));
    vm.prank(A);
    feed.attest(root, 60);
    assertTrue(feed.approved(proposal, A));

    vm.prank(A);
    feed.revoke(root, 60);
    assertEq(feed.approvals(proposal), 0);
    assertFalse(feed.approved(proposal, A));

    // The next single approval no longer finalizes the mistake.
    vm.prank(B);
    feed.attest(root, 60);
    assertFalse(feed.live(), "a revoked approval still counted");

    vm.expectRevert(ThresholdRootFeed.NotApproved.selector);
    vm.prank(C);
    feed.revoke(root, 60);
  }

  function test_CannotRevokeAfterFinalization() public {
    bytes32 root = keccak256("root");
    vm.prank(A);
    feed.attest(root, 70);
    vm.prank(B);
    feed.attest(root, 70);
    vm.expectRevert(abi.encodeWithSelector(ThresholdRootFeed.BlockNotNewer.selector, 70, 70));
    vm.prank(A);
    feed.revoke(root, 70);
  }

  function test_ProposalExpires() public {
    bytes32 root = keccak256("slow");
    bytes32 proposal = keccak256(abi.encode(root, uint256(80)));
    vm.prank(A);
    feed.attest(root, 80);

    vm.roll(block.number + feed.PROPOSAL_TTL_BLOCKS() + 1);
    assertEq(feed.approvals(proposal), 0, "expired approvals read as zero");

    vm.prank(B);
    feed.attest(root, 80);
    assertFalse(feed.live(), "an expired approval combined into a quorum");
    assertEq(feed.approvals(proposal), 1);

    // A re-approval in the fresh round is allowed and does finalize.
    vm.prank(A);
    feed.attest(root, 80);
    assertTrue(feed.live());
  }

  function test_FarFutureBlockIsRefusedOnceLive() public {
    bytes32 root = keccak256("root");
    vm.prank(A);
    feed.attest(root, 100);
    vm.prank(B);
    feed.attest(root, 100);

    uint256 maxAllowed = 100 + feed.MAX_FUTURE_BLOCKS();
    vm.expectRevert(
      abi.encodeWithSelector(ThresholdRootFeed.BlockTooFarAhead.selector, maxAllowed + 1, maxAllowed)
    );
    vm.prank(A);
    feed.attest(keccak256("far"), maxAllowed + 1);

    vm.prank(A);
    feed.attest(keccak256("edge"), maxAllowed);
  }

  function test_AttesterReplacementIsTimelockedAndVoidsInflightApprovals() public {
    address D = address(0xD00D);
    bytes32 root = keccak256("inflight");
    bytes32 proposal = keccak256(abi.encode(root, uint256(90)));
    vm.prank(C);
    feed.attest(root, 90);

    vm.expectRevert(ThresholdRootFeed.OnlyOwner.selector);
    vm.prank(OUTSIDER);
    feed.scheduleAttesterReplacement(C, D);

    feed.scheduleAttesterReplacement(C, D);
    (,, uint256 eta) = feed.pendingReplacement();
    assertEq(eta, block.timestamp + feed.ATTESTER_CHANGE_DELAY());

    vm.expectRevert(ThresholdRootFeed.ReplacementPending.selector);
    feed.scheduleAttesterReplacement(B, D);

    vm.expectRevert(
      abi.encodeWithSelector(ThresholdRootFeed.ReplacementTimelocked.selector, eta, block.timestamp)
    );
    feed.executeAttesterReplacement();

    vm.warp(eta);
    feed.executeAttesterReplacement();
    assertFalse(feed.isAttester(C));
    assertTrue(feed.isAttester(D));
    assertEq(feed.attesterCount(), 3);
    assertEq(feed.approvals(proposal), 0, "removed attester's approval voided");

    vm.expectRevert(abi.encodeWithSelector(ThresholdRootFeed.NotAttester.selector, C));
    vm.prank(C);
    feed.attest(root, 90);

    vm.prank(A);
    feed.attest(root, 90);
    assertFalse(feed.live(), "C's pre-rotation approval must not count");
    vm.prank(D);
    feed.attest(root, 90);
    assertTrue(feed.live());
  }

  function test_ReplacementCanBeCancelledAndOwnerIsTwoStep() public {
    feed.scheduleAttesterReplacement(C, address(0xD00D));
    feed.cancelAttesterReplacement();
    vm.expectRevert(ThresholdRootFeed.NoPendingReplacement.selector);
    feed.executeAttesterReplacement();

    feed.proposeOwner(OUTSIDER);
    assertEq(feed.owner(), address(this));
    vm.prank(OUTSIDER);
    feed.acceptOwner();
    assertEq(feed.owner(), OUTSIDER);
  }
}
