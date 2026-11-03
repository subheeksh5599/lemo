// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { RootFeed } from "lemo/RootFeed.sol";

/// @title RootFeedTest
/// @notice The single attester feed (audit H-07): strictly monotonic block
/// numbers, a two step delayed attester rotation accepted by the new key, a two
/// step owner handover, and a quorum of exactly one.
contract RootFeedTest is Test {
  address internal constant ATTESTER = address(0xA77E57);
  address internal constant NEXT = address(0x0E47);
  address internal constant STRANGER = address(0x5712A);

  RootFeed internal feed;

  function setUp() public {
    vm.warp(1_700_000_000);
    feed = new RootFeed(ATTESTER);
  }

  function test_QuorumIsOne() public view {
    assertEq(feed.quorum(), 1);
  }

  function test_AttestIsStrictlyMonotonic() public {
    vm.prank(ATTESTER);
    feed.attest(keccak256("a"), 10);

    vm.expectRevert(abi.encodeWithSelector(RootFeed.BlockNotNewer.selector, 10, 10));
    vm.prank(ATTESTER);
    feed.attest(keccak256("b"), 10);

    vm.expectRevert(abi.encodeWithSelector(RootFeed.BlockNotNewer.selector, 9, 10));
    vm.prank(ATTESTER);
    feed.attest(keccak256("older"), 9);

    assertEq(feed.currentRoot(), keccak256("a"));

    vm.prank(ATTESTER);
    feed.attest(keccak256("c"), 11);
    assertEq(feed.currentBlockNumber(), 11);
  }

  function test_FirstAttestationNeedsNonZeroBlock() public {
    vm.expectRevert(abi.encodeWithSelector(RootFeed.BlockNotNewer.selector, 0, 0));
    vm.prank(ATTESTER);
    feed.attest(keccak256("a"), 0);
  }

  function test_PinToIsMonotonicToo() public {
    vm.prank(ATTESTER);
    feed.attest(keccak256("a"), 10);
    vm.expectRevert(abi.encodeWithSelector(RootFeed.BlockNotNewer.selector, 5, 10));
    vm.prank(ATTESTER);
    feed.pinTo(keccak256("old"), 5);
  }

  function test_AttesterRotationIsTwoStepAndDelayed() public {
    vm.expectRevert(RootFeed.OnlyOwner.selector);
    vm.prank(STRANGER);
    feed.proposeAttester(NEXT);

    feed.proposeAttester(NEXT);
    uint256 eta = block.timestamp + feed.ATTESTER_DELAY();
    assertEq(feed.attester(), ATTESTER, "proposal alone moves nothing");

    vm.expectRevert(RootFeed.OnlyPendingAttester.selector);
    vm.prank(STRANGER);
    feed.acceptAttester();

    vm.expectRevert(abi.encodeWithSelector(RootFeed.AttesterTimelocked.selector, eta, block.timestamp));
    vm.prank(NEXT);
    feed.acceptAttester();

    // The current attester keeps working during the delay.
    vm.prank(ATTESTER);
    feed.attest(keccak256("a"), 1);

    vm.warp(eta);
    vm.prank(NEXT);
    feed.acceptAttester();
    assertEq(feed.attester(), NEXT);
    assertEq(feed.pendingAttester(), address(0));

    vm.expectRevert(RootFeed.OnlyAttester.selector);
    vm.prank(ATTESTER);
    feed.attest(keccak256("b"), 2);
  }

  function test_AttesterProposalCanBeCancelled() public {
    feed.proposeAttester(NEXT);
    feed.cancelAttesterProposal();
    vm.warp(block.timestamp + 2 days);
    vm.expectRevert(RootFeed.NoPendingAttester.selector);
    vm.prank(NEXT);
    feed.acceptAttester();
  }

  function test_OwnerHandoverIsTwoStep() public {
    feed.proposeOwner(NEXT);
    assertEq(feed.owner(), address(this));
    vm.expectRevert(RootFeed.OnlyPendingOwner.selector);
    vm.prank(STRANGER);
    feed.acceptOwner();
    vm.prank(NEXT);
    feed.acceptOwner();
    assertEq(feed.owner(), NEXT);

    vm.expectRevert(RootFeed.OnlyOwner.selector);
    feed.proposeAttester(STRANGER);
  }
}
