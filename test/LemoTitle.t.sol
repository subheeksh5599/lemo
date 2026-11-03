// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { LemoTitle, TitleLib, TitleRecord } from "lemo/LemoTitle.sol";

/// @title LemoTitleTest
/// @notice The canonical title commitment, checked against the shared vector
/// file that any off-chain tool is expected to reproduce, plus the revision rule.
contract LemoTitleTest is Test {
  string internal constant VECTORS = "shared/title-vectors.json";

  LemoTitle internal book;

  function setUp() public {
    vm.warp(1_700_000_000);
    book = new LemoTitle();
  }

  // ------------------------------------------------------------- the vectors

  /// @notice Every vector in shared/title-vectors.json must hash to its
  /// recorded digest. The file was generated independently (cast abi-encode
  /// then cast keccak), so agreement pins the encoding, not just this
  /// contract's arithmetic.
  function test_VectorHashesMatch() public view {
    string memory json = vm.readFile(VECTORS);
    string[] memory names = vm.parseJsonStringArray(json, ".names");
    string[] memory hashes = vm.parseJsonStringArray(json, ".hashes");
    assertGe(names.length, 3, "at least three vectors");

    for (uint256 i = 0; i < names.length; i += 1) {
      TitleRecord memory record = _recordAt(json, i);
      assertEq(TitleLib.hash(record), _b32(vm.parseBytes(hashes[i])), names[i]);
    }
  }

  /// @notice The three named vectors the brief asks for are present and
  /// distinct, and the two variants differ from the base in exactly one field.
  function test_RequiredVectorsExistAndDiffer() public view {
    string memory json = vm.readFile(VECTORS);
    uint256 base = _indexOf(json, "base");
    uint256 cleared = _indexOf(json, "identity-cleared");
    uint256 bumped = _indexOf(json, "revision-bumped");

    string[] memory hashes = vm.parseJsonStringArray(json, ".hashes");
    assertTrue(
      keccak256(bytes(hashes[base])) != keccak256(bytes(hashes[cleared])),
      "identity cleared must rehash"
    );
    assertTrue(
      keccak256(bytes(hashes[base])) != keccak256(bytes(hashes[bumped])),
      "revision bump must rehash"
    );

    TitleRecord memory baseRecord = _recordAt(json, base);
    TitleRecord memory clearedRecord = _recordAt(json, cleared);
    TitleRecord memory bumpedRecord = _recordAt(json, bumped);

    assertEq(clearedRecord.identityHash, bytes32(0), "cleared vector is cleared");
    assertEq(baseRecord.revision, 1);
    assertEq(bumpedRecord.revision, 2);
    assertEq(bumpedRecord.identityHash, baseRecord.identityHash, "only the revision changed");
    assertEq(bumpedRecord.backing, baseRecord.backing);
    assertEq(bumpedRecord.owner, baseRecord.owner);
  }

  function test_DomainConstantIsThePublishedOne() public view {
    string memory json = vm.readFile(VECTORS);
    assertEq(
      vm.parseBytes(vm.parseJsonString(json, ".domain")),
      abi.encodePacked(keccak256("LEMO.TITLE.COMMITMENT")),
      "domain separator"
    );
    assertEq(TitleLib.DOMAIN, keccak256("LEMO.TITLE.COMMITMENT"));
    assertEq(book.TITLE_VERSION(), 1);
    assertEq(vm.parseJsonUint(json, ".version"), 1);
  }

  /// @notice The version is inside the preimage: the same record hashed under
  /// version 2 is a different digest, so a future schema cannot collide with
  /// this one.
  function test_VersionIsCommitted() public view {
    string memory json = vm.readFile(VECTORS);
    TitleRecord memory record = _recordAt(json, _indexOf(json, "base"));

    bytes32 v1 = TitleLib.hash(record);
    bytes32 v2 = keccak256(
      abi.encode(
        keccak256("LEMO.TITLE.COMMITMENT"),
        uint256(2),
        record.titleId,
        record.chainId,
        record.nativeAsset,
        record.backing,
        record.owner,
        record.identityHash,
        record.vestingHash,
        record.permissionsHash,
        record.evmContract,
        record.revision
      )
    );
    assertTrue(v1 != v2, "the version must change the digest");
  }

  /// @notice A different domain changes the digest, so a record committed by
  /// another protocol cannot be replayed here.
  function test_DomainSeparates() public view {
    string memory json = vm.readFile(VECTORS);
    TitleRecord memory record = _recordAt(json, _indexOf(json, "base"));
    bytes32 withOtherDomain = keccak256(
      abi.encode(
        keccak256("ANOTHER.PROTOCOL.TITLE"),
        uint256(1),
        record.titleId,
        record.chainId,
        record.nativeAsset,
        record.backing,
        record.owner,
        record.identityHash,
        record.vestingHash,
        record.permissionsHash,
        record.evmContract,
        record.revision
      )
    );
    assertTrue(withOtherDomain != TitleLib.hash(record), "the domain must change the digest");
  }

  // ------------------------------------------------------- native encoding

  function test_NativeRecordRoundTrips() public view {
    string memory json = vm.readFile(VECTORS);
    uint256 count = vm.parseJsonStringArray(json, ".names").length;
    for (uint256 i = 0; i < count; i += 1) {
      TitleRecord memory record = _recordAt(json, i);
      bytes memory encoded = TitleLib.encodeNative(record);
      assertEq(encoded.length, 320, "native record width");

      (bool ok, TitleRecord memory decoded) = TitleLib.decodeNative(encoded);
      assertTrue(ok, "encoded record must decode");
      assertEq(TitleLib.hash(decoded), TitleLib.hash(record), "round trip keeps the hash");
    }
  }

  function test_DecodeRejectsWrongLength() public view {
    string memory json = vm.readFile(VECTORS);
    bytes memory encoded = TitleLib.encodeNative(_recordAt(json, 0));
    bytes memory shortRecord = new bytes(319);
    for (uint256 i = 0; i < 319; i += 1) {
      shortRecord[i] = encoded[i];
    }
    (bool ok,) = TitleLib.decodeNative(shortRecord);
    assertFalse(ok, "a 319 byte record is not a record");
  }

  // ---------------------------------------------------------- revision rule

  function test_FirstCommitMustBeRevisionOne() public {
    vm.expectRevert(abi.encodeWithSelector(LemoTitle.RevisionMustStartAtOne.selector, uint64(2)));
    book.commit(_recordAt2(2));
  }

  function test_RevisionAdvancesByExactlyOne() public {
    book.commit(_recordAt2(1));
    assertEq(book.titleOf(_id()).revision, 1);

    book.commit(_recordAt2(2));
    assertEq(book.titleOf(_id()).revision, 2);

    vm.expectRevert(
      abi.encodeWithSelector(LemoTitle.RevisionNotNext.selector, uint64(4), uint64(3))
    );
    book.commit(_recordAt2(4));

    vm.expectRevert(
      abi.encodeWithSelector(LemoTitle.RevisionNotNext.selector, uint64(2), uint64(3))
    );
    book.commit(_recordAt2(2));
  }

  function test_TitlesAreIndependent() public {
    bytes32 a = keccak256("title a");
    bytes32 b = keccak256("title b");
    book.commit(_recordWith(a, 1, 420420777));
    book.commit(_recordWith(b, 1, 420420777));
    assertEq(book.titleOf(a).revision, 1);
    assertEq(book.titleOf(b).revision, 1);
  }

  function test_ChainIdIsImmutablePerTitle() public {
    book.commit(_recordWith(_id(), 1, 420420777));
    vm.expectRevert(LemoTitle.ChainIdIsImmutable.selector);
    book.commit(_recordWith(_id(), 2, 1));
  }

  function test_OnlyWriterCommits() public {
    TitleRecord memory record = _recordAt2(1);
    vm.prank(address(0xBEEF));
    vm.expectRevert(LemoTitle.OnlyWriter.selector);
    book.commit(record);
  }

  /// @notice L-04: the writer handover is two step; the old writer keeps
  /// the role until the proposed one accepts, and nobody else can accept.
  function test_WriterHandoverIsTwoStep() public {
    address next = address(0xBEEF);
    vm.expectRevert(LemoTitle.OnlyWriterIsZeroAddress.selector);
    book.proposeWriter(address(0));

    book.proposeWriter(next);
    assertEq(book.writer(), address(this), "proposal alone moves nothing");
    assertEq(book.pendingWriter(), next);

    vm.expectRevert(LemoTitle.OnlyPendingWriter.selector);
    vm.prank(address(0xCAFE));
    book.acceptWriter();

    vm.prank(next);
    book.acceptWriter();
    assertEq(book.writer(), next);
    assertEq(book.pendingWriter(), address(0));

    vm.expectRevert(LemoTitle.OnlyWriter.selector);
    book.commit(_recordAt2(1));
  }

  /// @notice L-04: a record must name an owner.
  function test_ZeroOwnerIsRefused() public {
    TitleRecord memory record = _recordAt2(1);
    record.owner = address(0);
    vm.expectRevert(LemoTitle.OwnerIsZeroAddress.selector);
    book.commit(record);
  }

  function test_CommitmentTracksTheLatestRevision() public {
    TitleRecord memory rev1 = _recordAt2(1);
    book.commit(rev1);
    assertEq(book.commitmentOf(_id()), TitleLib.hash(rev1));

    TitleRecord memory rev2 = _recordAt2(2);
    book.commit(rev2);
    assertEq(book.commitmentOf(_id()), TitleLib.hash(rev2));
    assertTrue(TitleLib.hash(rev2) != TitleLib.hash(rev1));
  }

  // -------------------------------------------------------------- helpers

  function _id() private pure returns (bytes32) {
    return keccak256("LEMO.TITLE.TEST.LIB.1");
  }

  function _recordAt2(uint64 revision) private pure returns (TitleRecord memory) {
    return _recordWith(_id(), revision, 420420777);
  }

  function _recordWith(bytes32 titleId, uint64 revision, uint256 chainId)
    private
    pure
    returns (TitleRecord memory)
  {
    return TitleRecord({
      titleId: titleId,
      chainId: chainId,
      nativeAsset: keccak256("POT.native"),
      backing: keccak256("backing"),
      owner: address(0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266),
      identityHash: keccak256("identity"),
      vestingHash: keccak256("vesting"),
      permissionsHash: keccak256("permissions"),
      evmContract: address(0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC),
      revision: revision
    });
  }

  function _recordAt(string memory json, uint256 i) private pure returns (TitleRecord memory) {
    return TitleRecord({
      titleId: _b32(vm.parseBytes(vm.parseJsonString(json, _p(".records.titleId", i)))),
      chainId: vm.parseJsonUint(json, _p(".records.chainId", i)),
      nativeAsset: _b32(vm.parseBytes(vm.parseJsonString(json, _p(".records.nativeAsset", i)))),
      backing: _b32(vm.parseBytes(vm.parseJsonString(json, _p(".records.backing", i)))),
      owner: vm.parseAddress(vm.parseJsonString(json, _p(".records.owner", i))),
      identityHash: _b32(vm.parseBytes(vm.parseJsonString(json, _p(".records.identityHash", i)))),
      vestingHash: _b32(vm.parseBytes(vm.parseJsonString(json, _p(".records.vestingHash", i)))),
      permissionsHash: _b32(
        vm.parseBytes(vm.parseJsonString(json, _p(".records.permissionsHash", i)))
      ),
      evmContract: vm.parseAddress(vm.parseJsonString(json, _p(".records.evmContract", i))),
      revision: uint64(vm.parseJsonUint(json, _p(".records.revision", i)))
    });
  }

  function _p(string memory base, uint256 i) private pure returns (string memory) {
    return string.concat(base, "[", vm.toString(i), "]");
  }

  function _indexOf(string memory json, string memory name) private pure returns (uint256) {
    string[] memory names = vm.parseJsonStringArray(json, ".names");
    for (uint256 i = 0; i < names.length; i += 1) {
      if (keccak256(bytes(names[i])) == keccak256(bytes(name))) return i;
    }
    revert("vector not found");
  }

  function _b32(bytes memory data) private pure returns (bytes32 out) {
    require(data.length == 32, "not 32 bytes");
    assembly {
      out := mload(add(data, 0x20))
    }
  }
}
