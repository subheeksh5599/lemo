// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice The canonical LEMO title record, the value the native face stores.
///
/// Field order is fixed and is the order the commitment hashes. Nothing is
/// optional: a cleared identity is `identityHash == 0`, an unbound backing is
/// `backing == 0`, and a title with no EVM representation yet is
/// `evmContract == 0`. Making absence a value rather than a missing field is
/// what lets the gate fail closed on a record it can decode.
struct TitleRecord {
  bytes32 titleId;
  uint256 chainId;
  bytes32 nativeAsset;
  bytes32 backing;
  address owner;
  bytes32 identityHash;
  bytes32 vestingHash;
  bytes32 permissionsHash;
  address evmContract;
  uint64 revision;
}

/// @title TitleLib
/// @notice Domain separated, versioned commitment over a title record, plus the
/// fixed-width native encoding the trie proof carries.
///
/// Commitment (version 1):
///
///   keccak256(abi.encode(
///     keccak256("LEMO.TITLE.COMMITMENT"),  // domain
///     uint256(1),                          // version
///     titleId, chainId, nativeAsset, backing, owner,
///     identityHash, vestingHash, permissionsHash, evmContract, revision))
///
/// The domain and the version are both inside the preimage, so a record cannot
/// be replayed into another protocol or another schema revision: the same ten
/// fields under a different version hash to a different digest. `abi.encode`
/// pads every value to a 32 byte word, so revision is committed as a uint256.
library TitleLib {
  /// @dev Protocol wide domain separator. Not the versioned one.
  bytes32 internal constant DOMAIN = keccak256("LEMO.TITLE.COMMITMENT");

  /// @dev Schema version carried in the preimage and returned by the getters.
  uint16 internal constant VERSION = 1;

  /// @dev Every field is committed as one 32 byte big-endian word.
  uint256 internal constant NATIVE_RECORD_BYTES = 320;

  error NativeRecordWrongLength(uint256 length);

  /// @notice The versioned commitment over a record.
  function hash(TitleRecord memory r) internal pure returns (bytes32) {
    return keccak256(
      abi.encode(
        DOMAIN,
        uint256(VERSION),
        r.titleId,
        r.chainId,
        r.nativeAsset,
        r.backing,
        r.owner,
        r.identityHash,
        r.vestingHash,
        r.permissionsHash,
        r.evmContract,
        r.revision
      )
    );
  }

  /// @notice The native face encoding: ten 32 byte big-endian words.
  /// @dev Deliberately not SCALE. The native registry does not exist yet, so
  /// this repository defines the record layout it will carry and proves it
  /// end to end; see contracts/README.md "What is not deployed". A fixed
  /// width layout cannot be confused with a shorter read.
  function encodeNative(TitleRecord memory r) internal pure returns (bytes memory out) {
    out = abi.encodePacked(
      r.titleId,
      bytes32(r.chainId),
      r.nativeAsset,
      r.backing,
      bytes32(uint256(uint160(r.owner))),
      r.identityHash,
      r.vestingHash,
      r.permissionsHash,
      bytes32(uint256(uint160(r.evmContract))),
      bytes32(uint256(uint64(r.revision)))
    );
  }

  /// @notice Decode a proven native record. Fails closed on any other length.
  function decodeNative(bytes memory blob) internal pure returns (bool ok, TitleRecord memory r) {
    if (blob.length != NATIVE_RECORD_BYTES) return (false, r);
    r.titleId = _word(blob, 0);
    r.chainId = uint256(_word(blob, 1));
    r.nativeAsset = _word(blob, 2);
    r.backing = _word(blob, 3);
    uint256 ownerWord = uint256(_word(blob, 4));
    if (ownerWord >> 160 != 0) return (false, r);
    // forge-lint: disable-next-line(unsafe-typecast) -- the shift above rejects any high bits
    r.owner = address(uint160(ownerWord));
    r.identityHash = _word(blob, 5);
    r.vestingHash = _word(blob, 6);
    r.permissionsHash = _word(blob, 7);
    uint256 evmWord = uint256(_word(blob, 8));
    if (evmWord >> 160 != 0) return (false, r);
    // forge-lint: disable-next-line(unsafe-typecast) -- the shift above rejects any high bits
    r.evmContract = address(uint160(evmWord));
    uint256 revisionWord = uint256(_word(blob, 9));
    if (revisionWord >> 64 != 0) return (false, r);
    // forge-lint: disable-next-line(unsafe-typecast) -- the shift above rejects any high bits
    r.revision = uint64(revisionWord);
    return (true, r);
  }

  function _word(bytes memory blob, uint256 index) private pure returns (bytes32 word) {
    uint256 at = index * 32;
    assembly {
      word := mload(add(add(blob, 0x20), at))
    }
  }
}

/// @title LemoTitle
/// @notice The reference title book. It stores the latest record per title and
/// enforces the two rules a commitment cannot express on its own: title id and
/// chain id are immutable once set, and a revision only ever moves by one.
///
/// This contract is a reference implementation and is not deployed. The native
/// face is the authority on the real chain; this book exists so the revision
/// rule and the vector set have an executable definition.
///
/// The writer is a single key with a two step handover (`proposeWriter`, then
/// `acceptWriter` by the new writer), and a record must name a non-zero owner.
contract LemoTitle {
  address public writer;
  address public pendingWriter;
  uint16 public constant TITLE_VERSION = TitleLib.VERSION;

  mapping(bytes32 => TitleRecord) private _records;
  mapping(bytes32 => bool) private _known;
  mapping(bytes32 => bytes32) public commitmentOf;

  error OnlyWriter();
  error RevisionMustStartAtOne(uint64 provided);
  error RevisionNotNext(uint64 provided, uint64 expected);
  error ChainIdIsImmutable();
  error OnlyWriterIsZeroAddress();
  error OnlyPendingWriter();
  error OwnerIsZeroAddress();

  event TitleCommitted(
    bytes32 indexed titleId,
    uint64 revision,
    bytes32 commitment,
    address evmContract,
    bytes32 identityHash,
    bytes32 backing
  );

  constructor() {
    writer = msg.sender;
    emit WriterChanged(address(0), msg.sender);
  }

  event WriterChanged(address indexed previous, address indexed next);
  event WriterProposed(address indexed current, address indexed next);

  modifier onlyWriter() {
    if (msg.sender != writer) revert OnlyWriter();
    _;
  }

  /// @notice Step one of a writer change; the current writer stays in charge
  /// until the proposed one accepts.
  function proposeWriter(address next) external onlyWriter {
    if (next == address(0)) revert OnlyWriterIsZeroAddress();
    pendingWriter = next;
    emit WriterProposed(writer, next);
  }

  /// @notice Step two: the proposed writer takes the role itself.
  function acceptWriter() external {
    if (msg.sender != pendingWriter) revert OnlyPendingWriter();
    emit WriterChanged(writer, msg.sender);
    writer = msg.sender;
    delete pendingWriter;
  }

  /// @notice Commit a new revision of a title.
  /// @dev First commit must be revision 1. Every later commit must be exactly
  /// previous + 1, under the same title id and chain id. There is no path
  /// that skips, repeats or rewinds a revision.
  function commit(TitleRecord calldata record) external onlyWriter returns (bytes32 commitment) {
    if (record.owner == address(0)) revert OwnerIsZeroAddress();
    if (_known[record.titleId]) {
      TitleRecord memory previous = _records[record.titleId];
      if (previous.chainId != record.chainId) revert ChainIdIsImmutable();
      if (record.revision != previous.revision + 1) {
        revert RevisionNotNext(record.revision, previous.revision + 1);
      }
    } else {
      if (record.revision != 1) revert RevisionMustStartAtOne(record.revision);
    }

    commitment = TitleLib.hash(record);
    _records[record.titleId] = record;
    _known[record.titleId] = true;
    commitmentOf[record.titleId] = commitment;

    emit TitleCommitted(
      record.titleId,
      record.revision,
      commitment,
      record.evmContract,
      record.identityHash,
      record.backing
    );
  }

  function titleOf(bytes32 titleId) external view returns (TitleRecord memory) {
    return _records[titleId];
  }

  function known(bytes32 titleId) external view returns (bool) {
    return _known[titleId];
  }

  function commitmentOfTitle(bytes32 titleId) external view returns (bytes32) {
    return commitmentOf[titleId];
  }

  /// @notice Exposed so tests and off-chain tools hash through the same code.
  function hashTitle(TitleRecord calldata record) external pure returns (bytes32) {
    return TitleLib.hash(record);
  }

  function encodeNative(TitleRecord calldata record) external pure returns (bytes memory) {
    return TitleLib.encodeNative(record);
  }
}
