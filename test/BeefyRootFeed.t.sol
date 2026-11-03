// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { BeefyRootFeed, IStorageProofVerifier } from "lemo/BeefyRootFeed.sol";
import { SubstrateTrieVerifier } from "lemo/SubstrateTrieVerifier.sol";
import { ITitleVerifier } from "lemo/ITitleVerifier.sol";
import { TitleRecord, TitleLib } from "lemo/LemoTitle.sol";
import { TitleGateBase } from "lemo/TitleGateBase.sol";
import { TitleGateERC20 } from "lemo/TitleGateERC20.sol";
import { TestBlake2b } from "./harness/TestBlake2b.sol";
import { MockTitleVerifier } from "./harness/MockTitleVerifier.sol";

/// @title BeefyRootFeedTest
/// @notice BeefyRootFeed against real Portaldot V3 BEEFY data only.
///
/// Fixtures were written by scripts/capture-beefy.mjs from
/// wss://test-node-v3.portaldot.dev (every value is a chain read, checked in
/// the script before it was written):
///
///   beefy-rotation-pre.json   BEEFY block 308060, set 518, header 308059
///   beefy-rotation-post.json  BEEFY block 308066, set 519 (first block of the
///                             set, signed by the new set), header 308065
///   beefy-latest.json         BEEFY block 308450, set 519, header 308449
///
/// Nothing below is a synthetic proof: tamper tests flip bytes of the real data.
contract BeefyRootFeedTest is Test {
  struct Fx {
    bytes commitment;
    bytes sigs;
    bytes sig0;
    bytes sig1;
    bytes header;
    bytes32[] peaks;
    uint256 leafCount;
    uint64 setId;
    address[] auths;
    bytes32 stateRoot;
    uint256 number;
    bytes32 numberKey;
    bytes numberValue;
    bytes[] numberNodes;
    bytes[] nextNodes;
  }

  bytes32 internal constant LATEST_ROOT =
    0x85107ca9d84eb7872b16f006cdfc6976a13514db0fc1bc79c57a8b585f6589c9;
  bytes32 internal constant PRE_ROOT =
    0xf74d6cc1145af5a846f3fde9d943a179b49ff9d98f7bf68cd720529ae2de6bb8;
  bytes32 internal constant POST_ROOT =
    0x9e7c99874bd167211255f74cba6f97b773b1440f32bba326b0ce7d4c32961425;
  address internal constant AUTH0 = 0x4D13B6AeA6CD423CC48d7159ac10b26927c2B421;
  address internal constant AUTH1 = 0x4A69B8F722A9b486f9dB0d243C908170012d7413;

  TestBlake2b internal hasher;
  SubstrateTrieVerifier internal trie;
  Fx internal latest;
  Fx internal pre;
  Fx internal post;

  function setUp() public {
    hasher = new TestBlake2b();
    trie = new SubstrateTrieVerifier(hasher);
    _load(latest, "test/fixtures/beefy-latest.json");
    _load(pre, "test/fixtures/beefy-rotation-pre.json");
    _load(post, "test/fixtures/beefy-rotation-post.json");
  }

  // ------------------------------------------------------------ happy path

  function test_FixturesAreTheChainValues() public view {
    assertEq(latest.stateRoot, LATEST_ROOT);
    assertEq(latest.number, 308449);
    assertEq(latest.setId, 519);
    assertEq(pre.number, 308059);
    assertEq(pre.setId, 518);
    assertEq(post.number, 308065);
    assertEq(post.setId, 519);
    assertEq(latest.auths.length, 2);
    assertEq(latest.auths[0], AUTH0);
    assertEq(latest.auths[1], AUTH1);
  }

  function test_ValidSubmissionSetsExactRoot() public {
    BeefyRootFeed feed = _feed(latest);
    assertFalse(feed.live());
    assertEq(feed.quorum(), 2);
    uint256 g = gasleft();
    _submit(feed, latest);
    emit log_named_uint("submit gas (pure Solidity blake2b in test)", g - gasleft());
    assertTrue(feed.live());
    assertEq(feed.currentRoot(), LATEST_ROOT, "root is the header's state_root");
    assertEq(feed.currentBlockNumber(), 308449);
    assertEq(feed.beefyBlockNumber(), 308450);
  }

  /// @notice The BEEFY-derived root proves a real storage value: System.Number
  /// at block 308449 is 308449, little endian u32.
  function test_TrieProvesSystemNumberUnderBeefyRoot() public {
    BeefyRootFeed feed = _feed(latest);
    _submit(feed, latest);
    (ITitleVerifier.Status st, bytes memory value) =
      trie.verifyValue(feed.currentRoot(), abi.encodePacked(latest.numberKey), latest.numberNodes, latest.numberValue);
    assertEq(uint256(st), uint256(ITitleVerifier.Status.PROVEN), "System.Number not proven");
    assertEq(value, hex"e1b40400");
    uint256 n = uint8(value[0]) | uint256(uint8(value[1])) << 8 | uint256(uint8(value[2])) << 16
      | uint256(uint8(value[3])) << 24;
    assertEq(n, feed.currentBlockNumber(), "proven block number equals the feed's block");
  }

  function test_AcceptsSignaturesInEitherOrderAndEthV() public {
    BeefyRootFeed feed = _feed(latest);
    bytes memory s1 = latest.sig1;
    s1[64] = bytes1(uint8(s1[64]) + 27);
    feed.submit(latest.commitment, bytes.concat(s1, latest.sig0), latest.header, latest.peaks, latest.leafCount);
    assertEq(feed.currentRoot(), LATEST_ROOT);
  }

  // ------------------------------------------------------------ signatures

  function test_RevertOneSignatureMissing() public {
    BeefyRootFeed feed = _feed(latest);
    vm.expectRevert(abi.encodeWithSelector(BeefyRootFeed.NotEnoughSignatures.selector, 1));
    feed.submit(latest.commitment, latest.sig0, latest.header, latest.peaks, latest.leafCount);
    vm.expectRevert(abi.encodeWithSelector(BeefyRootFeed.NotEnoughSignatures.selector, 0));
    feed.submit(latest.commitment, "", latest.header, latest.peaks, latest.leafCount);
  }

  function test_RevertDuplicateSignature() public {
    BeefyRootFeed feed = _feed(latest);
    vm.expectRevert(abi.encodeWithSelector(BeefyRootFeed.DuplicateSigner.selector, AUTH0));
    feed.submit(latest.commitment, bytes.concat(latest.sig0, latest.sig0), latest.header, latest.peaks, latest.leafCount);
  }

  function test_RevertSignerNotInSet() public {
    // A real key outside the set signs the very same commitment.
    (address stranger, uint256 pk) = makeAddrAndKey("stranger");
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, keccak256(latest.commitment));
    BeefyRootFeed feed = _feed(latest);
    vm.expectRevert(abi.encodeWithSelector(BeefyRootFeed.UnknownSigner.selector, stranger));
    feed.submit(latest.commitment, bytes.concat(latest.sig0, abi.encodePacked(r, s, v)), latest.header, latest.peaks, latest.leafCount);

    // The real signature of a validator the feed does not hold.
    address[] memory other = new address[](2);
    other[0] = AUTH0;
    other[1] = stranger;
    BeefyRootFeed feed2 = new BeefyRootFeed(519, other, hasher, IStorageProofVerifier(address(trie)));
    vm.expectRevert(abi.encodeWithSelector(BeefyRootFeed.UnknownSigner.selector, AUTH1));
    _submit(feed2, latest);
  }

  function test_RevertMalformedSignatureBytes() public {
    BeefyRootFeed feed = _feed(latest);
    vm.expectRevert(BeefyRootFeed.BadEncoding.selector);
    feed.submit(latest.commitment, bytes.concat(latest.sigs, hex"00"), latest.header, latest.peaks, latest.leafCount);
  }

  // ------------------------------------------------------------ tampering

  function test_RevertTamperedCommitmentMmrRoot() public {
    BeefyRootFeed feed = _feed(latest);
    bytes memory c = latest.commitment;
    c[10] = bytes1(uint8(c[10]) ^ 1); // inside the 'mh' payload
    vm.expectPartialRevert(BeefyRootFeed.UnknownSigner.selector);
    feed.submit(c, latest.sigs, latest.header, latest.peaks, latest.leafCount);
  }

  function test_RevertTamperedCommitmentBlockNumber() public {
    BeefyRootFeed feed = _feed(latest);
    bytes memory c = latest.commitment;
    c[c.length - 12] = bytes1(uint8(c[c.length - 12]) ^ 1);
    vm.expectPartialRevert(BeefyRootFeed.UnknownSigner.selector);
    feed.submit(c, latest.sigs, latest.header, latest.peaks, latest.leafCount);
  }

  function test_RevertTruncatedCommitment() public {
    BeefyRootFeed feed = _feed(latest);
    bytes memory c = latest.commitment;
    assembly {
      mstore(c, sub(mload(c), 1))
    }
    vm.expectRevert(BeefyRootFeed.BadEncoding.selector);
    feed.submit(c, latest.sigs, latest.header, latest.peaks, latest.leafCount);
  }

  function test_RevertTamperedHeaderStateRoot() public {
    BeefyRootFeed feed = _feed(latest);
    bytes memory h = latest.header;
    h[40] = bytes1(uint8(h[40]) ^ 1); // inside state_root (offset 32 + 4 byte compact)
    vm.expectRevert(BeefyRootFeed.MmrRootMismatch.selector);
    feed.submit(latest.commitment, latest.sigs, h, latest.peaks, latest.leafCount);
  }

  function test_RevertTamperedHeaderDigest() public {
    BeefyRootFeed feed = _feed(latest);
    bytes memory h = latest.header;
    h[h.length - 1] = bytes1(uint8(h[h.length - 1]) ^ 1); // seal bytes, not parsed
    vm.expectRevert(BeefyRootFeed.MmrRootMismatch.selector);
    feed.submit(latest.commitment, latest.sigs, h, latest.peaks, latest.leafCount);
  }

  function test_RevertWrongHeader() public {
    // A genuine header, but not the parent of the signed block.
    BeefyRootFeed feed = _feed(latest);
    vm.expectRevert(abi.encodeWithSelector(BeefyRootFeed.HeaderNotParent.selector, 308065));
    feed.submit(latest.commitment, latest.sigs, post.header, latest.peaks, latest.leafCount);
  }

  function test_RevertTamperedMmrPeak() public {
    BeefyRootFeed feed = _feed(latest);
    bytes32[] memory p = latest.peaks;
    p[0] = p[0] ^ bytes32(uint256(1));
    vm.expectRevert(BeefyRootFeed.MmrRootMismatch.selector);
    feed.submit(latest.commitment, latest.sigs, latest.header, p, latest.leafCount);
  }

  function test_RevertWrongLeafCount() public {
    BeefyRootFeed feed = _feed(latest);
    vm.expectRevert();
    feed.submit(latest.commitment, latest.sigs, latest.header, latest.peaks, latest.leafCount + 1);
    vm.expectRevert();
    feed.submit(latest.commitment, latest.sigs, latest.header, latest.peaks, latest.leafCount - 2);
  }

  function test_RevertDroppedPeak() public {
    BeefyRootFeed feed = _feed(latest);
    bytes32[] memory p = new bytes32[](latest.peaks.length - 1);
    for (uint256 i; i < p.length; ++i) p[i] = latest.peaks[i + 1];
    vm.expectRevert(BeefyRootFeed.BadEncoding.selector);
    feed.submit(latest.commitment, latest.sigs, latest.header, p, latest.leafCount);
  }

  // ------------------------------------------------------------ set id, order

  function test_RevertWrongSetId() public {
    BeefyRootFeed feed = new BeefyRootFeed(520, latest.auths, hasher, IStorageProofVerifier(address(trie)));
    vm.expectRevert(abi.encodeWithSelector(BeefyRootFeed.WrongSetId.selector, 519, 520));
    _submit(feed, latest);
  }

  function test_RevertOlderOrSameBlock() public {
    BeefyRootFeed feed = _feed(latest);
    _submit(feed, latest);
    vm.expectRevert(abi.encodeWithSelector(BeefyRootFeed.BlockNotNewer.selector, 308449, 308449));
    _submit(feed, latest);
    vm.expectRevert(abi.encodeWithSelector(BeefyRootFeed.BlockNotNewer.selector, 308065, 308449));
    _submit(feed, post);
    assertEq(feed.currentRoot(), LATEST_ROOT);
  }

  // ------------------------------------------------------------ rotation

  /// @notice Real rotation 518 -> 519: a set-518 root proves
  /// MmrLeaf::BeefyNextAuthorities (id 519), the feed moves, and the first
  /// block of set 519 (signed by 519) then lands, followed by a later one.
  function test_RotationAcrossRealSetChange() public {
    BeefyRootFeed feed = _feed(pre);
    assertEq(feed.validatorSetId(), 518);

    // Before rotation, a set-519 commitment is refused.
    vm.expectRevert(abi.encodeWithSelector(BeefyRootFeed.WrongSetId.selector, 519, 518));
    _submit(feed, post);

    _submit(feed, pre);
    assertEq(feed.currentRoot(), PRE_ROOT);
    assertEq(feed.currentBlockNumber(), 308059);

    feed.rotate(pre.auths, pre.nextNodes);
    assertEq(feed.validatorSetId(), 519);
    assertEq(feed.authorityIndex(519, AUTH0), 1);
    assertEq(feed.authorityIndex(519, AUTH1), 2);
    assertEq(feed.authoritySetSize(), 2);

    _submit(feed, post);
    assertEq(feed.currentRoot(), POST_ROOT);
    assertEq(feed.currentBlockNumber(), 308065);

    _submit(feed, latest);
    assertEq(feed.currentRoot(), LATEST_ROOT);
  }

  function test_RotationRejectsWrongSet() public {
    BeefyRootFeed feed = _feed(pre);
    _submit(feed, pre);

    address[] memory swapped = new address[](2);
    swapped[0] = AUTH1;
    swapped[1] = AUTH0;
    vm.expectRevert(BeefyRootFeed.NextSetMismatch.selector);
    feed.rotate(swapped, pre.nextNodes);

    address[] memory foreign = new address[](2);
    foreign[0] = AUTH0;
    foreign[1] = makeAddr("attacker");
    vm.expectRevert(BeefyRootFeed.NextSetMismatch.selector);
    feed.rotate(foreign, pre.nextNodes);

    address[] memory one = new address[](1);
    one[0] = AUTH0;
    vm.expectRevert(BeefyRootFeed.NextSetMismatch.selector);
    feed.rotate(one, pre.nextNodes);

    // A tampered storage proof is not PROVEN.
    bytes[] memory nodes = pre.nextNodes;
    bytes memory n0 = nodes[0];
    n0[n0.length - 1] = bytes1(uint8(n0[n0.length - 1]) ^ 1);
    vm.expectPartialRevert(BeefyRootFeed.NextSetNotProven.selector);
    feed.rotate(pre.auths, nodes);

    assertEq(feed.validatorSetId(), 518, "set unchanged after every refusal");
  }

  function test_RotationOnlyOnceFromTheSameRoot() public {
    BeefyRootFeed feed = _feed(pre);
    _submit(feed, pre);
    feed.rotate(pre.auths, pre.nextNodes);
    // The same root still names id 519, which is no longer current + 1.
    vm.expectRevert(BeefyRootFeed.NextSetMismatch.selector);
    feed.rotate(pre.auths, pre.nextNodes);
  }

  function test_RotationNeedsARoot() public {
    BeefyRootFeed feed = _feed(pre);
    vm.expectPartialRevert(BeefyRootFeed.NextSetNotProven.selector);
    feed.rotate(pre.auths, pre.nextNodes);
  }

  // ------------------------------------------------------------ constructor

  function test_ConstructorRejectsBadSets() public {
    IStorageProofVerifier v = IStorageProofVerifier(address(trie));
    address[] memory dup = new address[](2);
    dup[0] = AUTH0;
    dup[1] = AUTH0;
    vm.expectRevert(BeefyRootFeed.BadAuthorities.selector);
    new BeefyRootFeed(519, dup, hasher, v);
    vm.expectRevert(BeefyRootFeed.BadAuthorities.selector);
    new BeefyRootFeed(519, new address[](0), hasher, v);
    address[] memory zero = new address[](1);
    vm.expectRevert(BeefyRootFeed.BadAuthorities.selector);
    new BeefyRootFeed(519, zero, hasher, v);
  }

  // ------------------------------------------------------------ end to end

  /// @notice A gate wired to the BEEFY feed refuses before a root lands, takes
  /// a proof at the BEEFY-finalized root, and refuses a proof at any other root.
  /// The title verdict is mocked: Portaldot V3's runtime carries no LEMO title
  /// pallet, so no real title exists under a real root; the root itself is real.
  function test_GateAcceptsBeefyRoot() public {
    BeefyRootFeed feed = _feed(pre);
    MockTitleVerifier mock = new MockTitleVerifier();
    bytes32 titleId = keccak256("LEMO.TITLE.BEEFY");
    address alice = makeAddr("alice");

    address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
    TitleRecord memory rec = TitleRecord({
      titleId: titleId,
      chainId: block.chainid,
      nativeAsset: keccak256("POT.native"),
      backing: keccak256("backing"),
      owner: alice,
      identityHash: keccak256("identity"),
      vestingHash: keccak256("vesting"),
      permissionsHash: keccak256("permissions"),
      evmContract: predicted,
      revision: 1
    });
    TitleGateERC20 gate =
      new TitleGateERC20(mock, feed, titleId, TitleLib.hash(rec), address(this), "LEMO", "LT", 100);
    assertEq(address(gate), predicted);
    mock.set(ITitleVerifier.Status.PROVEN, rec);

    ITitleVerifier.TitleProof memory proof = ITitleVerifier.TitleProof({
      titleId: titleId,
      chainId: block.chainid,
      revision: 1,
      token: address(gate),
      operation: 2,
      stateRoot: PRE_ROOT,
      storageKey: "",
      nodes: new bytes[](0)
    });

    vm.expectRevert(TitleGateBase.FeedHasNoRoot.selector);
    gate.mint(alice, 100, proof);

    _submit(feed, pre);
    feed.rotate(pre.auths, pre.nextNodes);
    _submit(feed, post);

    // A proof at an older (pre-rotation) BEEFY root is stale.
    vm.expectRevert(abi.encodeWithSelector(TitleGateBase.FeedRootMismatch.selector, PRE_ROOT, POST_ROOT));
    gate.mint(alice, 100, proof);

    proof.stateRoot = feed.currentRoot();
    gate.mint(alice, 100, proof);
    assertEq(gate.balanceOf(alice), 100, "minted against the BEEFY-finalized root");
  }

  // ------------------------------------------------------------ relayer

  /// @notice scripts/relay-beefy.mjs, planning from a feed at (set 518, block
  /// 308000), wrote test/fixtures/beefy-relay-plan.json: submit 308060, rotate
  /// to 519, submit the newest block. Its exact calldata is replayed here, so the
  /// relayer's hand-rolled ABI encoder is checked against the contract.
  function test_RelayerPlanReplays() public {
    string memory j = vm.readFile("test/fixtures/beefy-relay-plan.json");
    BeefyRootFeed feed = _feed(pre);
    assertEq(vm.parseJsonString(j, ".steps[0].kind"), "submit");
    assertEq(vm.parseJsonString(j, ".steps[1].kind"), "rotate");
    assertEq(vm.parseJsonString(j, ".steps[2].kind"), "submit");

    (bool ok,) = address(feed).call(vm.parseJsonBytes(j, ".steps[0].data"));
    assertTrue(ok, "relayer submit (set 518)");
    assertEq(feed.currentRoot(), PRE_ROOT);

    (ok,) = address(feed).call(vm.parseJsonBytes(j, ".steps[1].data"));
    assertTrue(ok, "relayer rotate");
    assertEq(feed.validatorSetId(), 519);

    (ok,) = address(feed).call(vm.parseJsonBytes(j, ".steps[2].data"));
    assertTrue(ok, "relayer submit (set 519)");
    assertEq(feed.currentRoot(), vm.parseJsonBytes32(j, ".steps[2].stateRoot"));
    assertEq(feed.currentBlockNumber(), vm.parseJsonUint(j, ".steps[2].block"));
  }

  // ------------------------------------------------------------ helpers

  function _feed(Fx storage f) internal returns (BeefyRootFeed) {
    return new BeefyRootFeed(f.setId, f.auths, hasher, IStorageProofVerifier(address(trie)));
  }

  function _submit(BeefyRootFeed feed, Fx storage f) internal {
    feed.submit(f.commitment, f.sigs, f.header, f.peaks, f.leafCount);
  }

  function _load(Fx storage f, string memory path) internal {
    string memory j = vm.readFile(path);
    f.commitment = vm.parseJsonBytes(j, ".commitment");
    f.sigs = vm.parseJsonBytes(j, ".signaturesPacked");
    bytes[] memory s = vm.parseJsonBytesArray(j, ".signatures");
    f.sig0 = s[0];
    f.sig1 = s[1];
    f.header = vm.parseJsonBytes(j, ".header.hex");
    bytes32[] memory peaks = vm.parseJsonBytes32Array(j, ".mmr.peaks");
    for (uint256 i; i < peaks.length; ++i) f.peaks.push(peaks[i]);
    f.leafCount = vm.parseJsonUint(j, ".mmr.leafCount");
    f.setId = uint64(vm.parseJsonUint(j, ".validatorSetId"));
    address[] memory a = vm.parseJsonAddressArray(j, ".authorities.ethAddresses");
    for (uint256 i; i < a.length; ++i) f.auths.push(a[i]);
    f.stateRoot = vm.parseJsonBytes32(j, ".header.stateRoot");
    f.number = vm.parseJsonUint(j, ".header.number");
    f.numberKey = vm.parseJsonBytes32(j, ".proofs.systemNumber.key");
    f.numberValue = vm.parseJsonBytes(j, ".proofs.systemNumber.value");
    bytes[] memory nn = vm.parseJsonBytesArray(j, ".proofs.systemNumber.nodes");
    for (uint256 i; i < nn.length; ++i) f.numberNodes.push(nn[i]);
    bytes[] memory nx = vm.parseJsonBytesArray(j, ".proofs.beefyNextAuthorities.nodes");
    for (uint256 i; i < nx.length; ++i) f.nextNodes.push(nx[i]);
  }
}
