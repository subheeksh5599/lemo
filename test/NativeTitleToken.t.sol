// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test, stdJson } from "forge-std/Test.sol";
import { NativeTitleToken, IRootFeed, ITrieVerify } from "lemo/NativeTitleToken.sol";
import { SubstrateTrieVerifier } from "lemo/SubstrateTrieVerifier.sol";
import { TestBlake2b } from "./harness/TestBlake2b.sol";

/// A feed that holds one root; the live token reads BeefyRootFeed instead.
contract FixedFeed is IRootFeed {
  bytes32 public currentRoot;
  uint256 public currentBlockNumber;

  function set(bytes32 root, uint256 n) external {
    currentRoot = root;
    currentBlockNumber = n;
  }
}

/// Every proof below is a real Portaldot V3 capture: collection 12, item 0,
/// created by extrinsic 319111-1 (scripts/native-title.mjs) and read at block
/// 319115 (scripts/capture-native-title.mjs).
contract NativeTitleTokenTest is Test {
  using stdJson for string;

  FixedFeed feed;
  NativeTitleToken token;
  string fx;
  bytes key;
  bytes[] nodes;
  bytes missingKey;
  bytes[] missingNodes;
  address owner;
  bytes32 root;

  function setUp() public {
    fx = vm.readFile("test/fixtures/native-title.json");
    key = fx.readBytes(".key");
    missingKey = fx.readBytes(".missingKey");
    bytes[] memory n = fx.readBytesArray(".nodes");
    for (uint256 i; i < n.length; i++) nodes.push(n[i]);
    bytes[] memory m = fx.readBytesArray(".missingNodes");
    for (uint256 i; i < m.length; i++) missingNodes.push(m[i]);
    owner = fx.readAddress(".ownerEvm");
    root = fx.readBytes32(".stateRoot");

    feed = new FixedFeed();
    feed.set(root, fx.readUint(".block"));
    SubstrateTrieVerifier trie = new SubstrateTrieVerifier(new TestBlake2b());
    token = new NativeTitleToken(feed, ITrieVerify(address(trie)));
  }

  function test_MappedAddressMatchesRevive() public view {
    assertEq(token.mappedAddress(fx.readBytes32(".owner")), owner);
  }

  function test_NativeOwnerClaimsOnce() public {
    vm.prank(owner);
    token.claim(key, nodes);
    assertEq(token.balanceOf(owner), 1000e18);
    assertEq(token.totalSupply(), 1000e18);
    vm.prank(owner);
    vm.expectRevert(NativeTitleToken.AlreadyClaimed.selector);
    token.claim(key, nodes);
  }

  function test_RevertClaimBySomeoneElse() public {
    vm.prank(address(0xBEEF));
    vm.expectRevert(abi.encodeWithSelector(NativeTitleToken.NotTheNativeOwner.selector, owner));
    token.claim(key, nodes);
  }

  function test_RevertClaimWithTamperedProof() public {
    bytes[] memory bad = new bytes[](nodes.length);
    for (uint256 i; i < nodes.length; i++) bad[i] = nodes[i];
    bytes memory first = bad[0];
    first[first.length - 1] = bytes1(uint8(first[first.length - 1]) ^ 1);
    vm.prank(owner);
    vm.expectRevert();
    token.claim(key, bad);
  }

  function test_RevertClaimUnderAnotherRoot() public {
    feed.set(keccak256("not the signed root"), 1);
    vm.prank(owner);
    vm.expectRevert();
    token.claim(key, nodes);
  }

  function test_RevertClaimForMissingItem() public {
    vm.prank(owner);
    vm.expectRevert(abi.encodeWithSelector(NativeTitleToken.NotProven.selector, uint8(2)));
    token.claim(missingKey, missingNodes);
  }

  function test_RevertKeyFromAnotherPallet() public {
    bytes memory other = bytes.concat(bytes32(0), new bytes(40));
    vm.expectRevert(NativeTitleToken.BadKey.selector);
    token.claim(other, nodes);
  }

  function test_TransferWhileHeldNatively() public {
    vm.prank(owner);
    token.claim(key, nodes);
    vm.prank(owner);
    token.transfer(address(0xCAFE), 400e18);
    assertEq(token.balanceOf(address(0xCAFE)), 400e18);
  }

  function test_RevertFreezeWhileOwnerStillHolds() public {
    vm.prank(owner);
    token.claim(key, nodes);
    vm.expectRevert(NativeTitleToken.StillHeld.selector);
    token.freeze(key, nodes);
  }

  function test_RevertFreezeBeforeClaim() public {
    vm.expectRevert(NativeTitleToken.NotClaimed.selector);
    token.freeze(key, nodes);
  }

  function test_NativeBurnFreezesTheRepresentation() public {
    vm.prank(owner);
    token.claim(key, nodes);
    vm.prank(owner);
    token.transfer(address(0xCAFE), 400e18);

    // The verifier's answer after a native burn is ABSENT; the live run proves it
    // on Portaldot V3, so here the answer is mocked to test the token's reaction.
    vm.mockCall(
      address(token.verifier()),
      abi.encodeWithSelector(ITrieVerify.verify.selector),
      abi.encode(uint8(2), bytes(""))
    );
    token.freeze(key, nodes);
    vm.clearMockedCalls();

    vm.prank(owner);
    vm.expectRevert(NativeTitleToken.TitleFrozen.selector);
    token.transfer(address(0xCAFE), 1);
    vm.prank(address(0xCAFE));
    vm.expectRevert(NativeTitleToken.TitleFrozen.selector);
    token.transfer(owner, 1);

    // retiring the representation is still allowed
    vm.prank(address(0xCAFE));
    token.burn(400e18);
    vm.prank(owner);
    token.burn(600e18);
    assertEq(token.totalSupply(), 0);
  }

  function test_NativeSaleFreezesTheRepresentation() public {
    vm.prank(owner);
    token.claim(key, nodes);
    bytes memory value = fx.readBytes(".value");
    // the same record with a different owner: what a native nfts.transfer leaves
    value[0] = bytes1(uint8(value[0]) ^ 0xff);
    vm.mockCall(address(token.verifier()), abi.encodeWithSelector(ITrieVerify.verify.selector), abi.encode(uint8(1), value));
    token.freeze(key, nodes);
    vm.clearMockedCalls();
    vm.prank(owner);
    vm.expectRevert(NativeTitleToken.TitleFrozen.selector);
    token.transfer(address(0xCAFE), 1);
  }
}
