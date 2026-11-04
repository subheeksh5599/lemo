// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IRootFeed } from "./IRootFeed.sol";
import { IBlake2b256 } from "./IBlake2b256.sol";

/// @title BeefyRootFeed
/// @notice A root feed with no attester: a state root lands only when Portaldot's
/// own BEEFY validators finalized it. Anyone may relay; nobody can choose.
///
/// # What `submit` proves
///
///  1. BEEFY signatures. More than 2/3 of the current authority set (BEEFY's
///     `n - (n-1)/3`; both of 2) signed keccak256(SCALE Commitment). Each
///     signature is recovered with ecrecover and must map to a distinct member
///     of the stored set. Unknown or repeated signers revert.
///  2. The commitment is for the stored validator set id, and its 'mh' payload
///     is the MMR root of the chain at the commitment block N.
///  3. MMR membership of the NEWEST leaf. Portaldot's MMR leaf is
///     SCALE((u32 parent_number, H256 parent_hash)), hashed with keccak256: the
///     leaf block N appends describes block N-1. Given the peaks of the MMR
///     before that append (on chain as `Mmr::Nodes` at N-1) and the leaf count
///     after it, the root is rebuilt here (ckb MMR, peaks bagged right to left
///     as keccak(right || left)) and must equal the signed 'mh'.
///  4. The header. The leaf is computed here from the submitted SCALE header of
///     N-1: hash = blake2b256(header), number = the header's own compact
///     number, which must be N-1. So the header is exactly the block the
///     validators finalized, and its state_root becomes `currentRoot`.
///
/// The public Portaldot V3 node does not serve `mmr_generateProof` (LeafNotFound:
/// no offchain indexing), so only the newest leaf of a BEEFY commitment can be
/// proven, which is all a root feed needs. See docs/FINALITY.md.
///
/// # Authority rotation
///
/// Portaldot's BEEFY set id advances every session while its membership has
/// stayed the same (the next-authority keyset commitment equals the current
/// one). `submit` therefore follows a rotation implicitly: a commitment for
/// set id `current + 1`, signed by more than 2/3 of the STORED keys, advances
/// the stored set id. A jump of more than one is refused, so sets are walked
/// in order. If the real membership ever changes, the stored keys can no
/// longer reach the threshold and the feed stalls: it fails closed and never
/// accepts a root the stored keys did not sign. A membership change needs a
/// new deployment with a new checkpoint.
///
/// # The one trust assumption
///
/// The constructor's (validatorSetId, authorities) is a checkpoint taken on
/// deploy, and those keys are trusted to sign BEEFY commitments only for
/// blocks GRANDPA finalized, which is what BEEFY validators do. Anyone can
/// check the checkpoint against `beefy.authorities` at a stated block.
/// Everything after it follows from signatures and hashes. There is no owner,
/// no admin, no pause.
contract BeefyRootFeed is IRootFeed {
  IBlake2b256 public immutable hasher;

  uint64 public validatorSetId;
  /// @notice Number of authorities in the current set.
  uint256 public authoritySetSize;
  /// @notice 1 + position of an address in the stored set, 0 when not a member.
  mapping(address => uint256) public authorityIndex;

  bytes32 public currentRoot;
  uint256 public currentBlockNumber;
  /// @notice The BEEFY commitment block that finalized the current root (N).
  uint256 public beefyBlockNumber;

  event RootFinalized(bytes32 indexed root, uint256 blockNumber, uint256 beefyBlock, uint256 setId);
  event SetAdvanced(uint256 indexed setId);

  error BadAuthorities();
  error BadEncoding();
  error WrongSetId(uint256 claimed, uint256 current);
  error UnknownSigner(address signer);
  error DuplicateSigner(address signer);
  error NotEnoughSignatures(uint256 got);
  error MmrRootMismatch();
  error HeaderNotParent(uint256 header);
  error BlockNotNewer(uint256 claimed, uint256 accepted);

  constructor(uint64 validatorSetId_, address[] memory authorities_, IBlake2b256 hasher_) {
    if (address(hasher_) == address(0)) revert BadAuthorities();
    hasher = hasher_;
    uint256 n = authorities_.length;
    if (n == 0 || n > 256) revert BadAuthorities();
    unchecked {
      for (uint256 i; i < n; ++i) {
        address x = authorities_[i];
        if (x == address(0) || authorityIndex[x] != 0) revert BadAuthorities();
        authorityIndex[x] = i + 1;
      }
    }
    validatorSetId = validatorSetId_;
    authoritySetSize = n;
  }

  // ------------------------------------------------------------------ submit

  /// @param commitment SCALE `Commitment { payload, block_number u32, validator_set_id u64 }`
  /// @param signatures packed 65 byte (r, s, v) signatures, v in {0,1,27,28}
  /// @param header SCALE header of block N-1
  /// @param peaks MMR peaks before the newest leaf, left to right (`Mmr::Nodes` at N-1)
  /// @param leafCount MMR leaf count at N (`Mmr::NumberOfLeaves` at N)
  function submit(
    bytes calldata commitment,
    bytes calldata signatures,
    bytes calldata header,
    bytes32[] calldata peaks,
    uint256 leafCount
  ) external {
    (bytes32 mmrRoot, uint256 beefyBlock) = _verifyCommitment(commitment, signatures);

    (uint256 number, bytes32 stateRoot) = _decodeHeader(header);
    if (number + 1 != beefyBlock) revert HeaderNotParent(number);
    if (number <= currentBlockNumber) revert BlockNotNewer(number, currentBlockNumber);

    if (_newestLeafRoot(peaks, leafCount, _leafHash(number, header)) != mmrRoot) {
      revert MmrRootMismatch();
    }

    currentRoot = stateRoot;
    currentBlockNumber = number;
    beefyBlockNumber = beefyBlock;
    emit RootFinalized(stateRoot, number, beefyBlock, validatorSetId);
  }

  function _verifyCommitment(bytes calldata commitment, bytes calldata signatures)
    private
    returns (bytes32 mmrRoot, uint256 beefyBlock)
  {
    uint256 setId;
    (mmrRoot, beefyBlock, setId) = _decodeCommitment(commitment);
    uint256 current = validatorSetId;
    if (setId != current && setId != current + 1) revert WrongSetId(setId, current);
    _checkSignatures(keccak256(commitment), signatures);
    if (setId != current) {
      // Implicit rotation: the stored keys signed for the next set id.
      validatorSetId = uint64(setId);
      emit SetAdvanced(setId);
    }
  }

  // ------------------------------------------------------------------ views

  function live() external view returns (bool) {
    return currentRoot != bytes32(0);
  }

  /// @inheritdoc IRootFeed
  /// @dev Signatures required from the current BEEFY set: n - floor((n-1)/3).
  function quorum() public view returns (uint256) {
    uint256 n = authoritySetSize;
    return n - (n - 1) / 3;
  }

  // ------------------------------------------------------------------ internals

  function _checkSignatures(bytes32 digest, bytes calldata sigs) private view {
    if (sigs.length % 65 != 0) _bad();
    uint256 n = authoritySetSize;
    uint256 seen;
    uint256 count = sigs.length / 65;
    unchecked {
      for (uint256 k; k < count; ++k) {
        uint256 o;
        assembly {
          o := add(sigs.offset, mul(k, 65))
        }
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
          r := calldataload(o)
          s := calldataload(add(o, 32))
          v := byte(0, calldataload(add(o, 64)))
        }
        if (v < 27) v += 27;
        address signer = ecrecover(digest, v, r, s);
        uint256 idx = authorityIndex[signer];
        if (idx == 0) revert UnknownSigner(signer);
        uint256 bit = 1 << (idx - 1);
        if (seen & bit != 0) revert DuplicateSigner(signer);
        seen |= bit;
      }
    }
    if (count < n - (n - 1) / 3) revert NotEnoughSignatures(count);
  }

  /// @dev Finds the single 'mh' entry; the encoding must end exactly after
  /// block_number (u32) and validator_set_id (u64).
  function _decodeCommitment(bytes calldata c)
    private
    pure
    returns (bytes32 mmrRoot, uint256 blockNumber, uint256 setId)
  {
    (uint256 base, uint256 len) = _span(c);
    (uint256 entries, uint256 off) = _compact(base, len, 0);
    bool found;
    unchecked {
      // off and every length are < 2^30, so none of these sums overflow.
      for (uint256 i; i < entries; ++i) {
        if (len < off + 2) _bad();
        uint256 id = _le(base, off, 2);
        uint256 l;
        (l, off) = _compact(base, len, off + 2);
        if (len < off + l) _bad();
        if (id == 0x686d) {
          // "mh"
          if (found || l != 32) _bad();
          found = true;
          assembly {
            mmrRoot := calldataload(add(base, off))
          }
        }
        off += l;
      }
      if (!found || len != off + 12) _bad();
      blockNumber = _le(base, off, 4);
      setId = _le(base, off + 4, 8);
    }
  }

  /// @dev parent_hash (32) | compact number | state_root (32) | extrinsics_root | digest
  function _decodeHeader(bytes calldata h) private pure returns (uint256 number, bytes32 stateRoot) {
    (uint256 base, uint256 len) = _span(h);
    uint256 off;
    (number, off) = _compact(base, len, 32);
    if (len < off + 32) _bad();
    assembly {
      stateRoot := calldataload(add(base, off))
    }
  }

  /// @dev The MMR leaf of block N-1: keccak256(SCALE((u32 number, H256 blake2b256(header)))).
  function _leafHash(uint256 number, bytes calldata header) private view returns (bytes32) {
    uint32 le = uint32((number & 0xff) << 24 | (number & 0xff00) << 8 | (number & 0xff0000) >> 8 | number >> 24);
    return keccak256(abi.encodePacked(le, hasher.hash(header)));
  }

  function _newestLeafRoot(bytes32[] calldata peaks, uint256 leafCount, bytes32 leafHash)
    private
    pure
    returns (bytes32 root)
  {
    if (leafCount == 0) _bad();
    unchecked {
      uint256 before = leafCount - 1;
      uint256 p = peaks.length;
      root = leafHash;
      // The new leaf merges with every peak of the same height to its left.
      while (before & 1 == 1) {
        if (p == 0) _bad();
        root = _h(peaks[--p], root);
        before >>= 1;
      }
      // What is left must be exactly one peak per remaining set bit.
      uint256 bits;
      for (; before != 0; before >>= 1) {
        bits += before & 1;
      }
      if (bits != p) _bad();
      // Bag right to left: keccak(right || left).
      for (; p > 0; --p) {
        root = _h(root, peaks[p - 1]);
      }
    }
  }

  function _span(bytes calldata b) private pure returns (uint256 base, uint256 len) {
    assembly {
      base := b.offset
      len := b.length
    }
  }

  /// @dev SCALE compact, single, two and four byte modes only (< 2^30).
  function _compact(uint256 base, uint256 len, uint256 off)
    private
    pure
    returns (uint256 v, uint256 next)
  {
    if (off >= len) _bad();
    uint256 mode = _le(base, off, 1) & 3;
    if (mode == 3) _bad();
    unchecked {
      next = off + (1 << mode);
    }
    if (len < next) _bad();
    v = _le(base, off, 1 << mode) >> 2;
  }

  /// @dev Little endian unsigned integer of n <= 32 bytes at calldata base + off.
  function _le(uint256 base, uint256 off, uint256 n) private pure returns (uint256 v) {
    assembly {
      let w := calldataload(add(base, off))
      for { let i := 0 } lt(i, n) { i := add(i, 1) } {
        v := or(v, shl(mul(8, i), byte(i, w)))
      }
    }
  }

  function _h(bytes32 a, bytes32 b) private pure returns (bytes32 r) {
    assembly {
      mstore(0, a)
      mstore(32, b)
      r := keccak256(0, 64)
    }
  }

  function _bad() private pure {
    revert BadEncoding();
  }
}
