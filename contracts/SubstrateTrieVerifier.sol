// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IBlake2b256 } from "./IBlake2b256.sol";
import { TitleLib, TitleRecord } from "./LemoTitle.sol";
import { ITitleVerifier } from "./ITitleVerifier.sol";

/// @title SubstrateTrieVerifier
/// @notice Verifies a Substrate (sp-trie) state proof inside the EVM and returns
/// the proven value, or a status that says exactly why it refused.
///
/// # What is proven
///
/// Given a state root the chain reported for a finalized block, a storage key
/// and the raw node byte strings a node returned for `state_getReadProof`, this
/// contract walks the path from the root to the key, re-hashing every 32 byte
/// child reference with blake2b-256. A value is PROVEN only when the walk
/// arrived at a node whose bytes are committed by that root.
///
/// # Node layout (sp-trie, parity-scale-codec NodeHeader)
///
///   header      0x00                     empty node
///               0x40 .. 0x7f             leaf,               partial count in 6 bits
///               0x80 .. 0xbf             branch, no value,   partial count in 6 bits
///               0xc0 .. 0xff             branch with value,  partial count in 6 bits
///               0x20 .. 0x3f             leaf whose value is its own node (5 bits)
///               0x10 .. 0x1f             branch whose value is its own node (4 bits)
///
/// The field holds the count itself, never count - 1. When the field is all ones
/// for its width, continuation bytes follow: subtract one, then add 255 per 0xff
/// byte until a byte below 0xff arrives, and that final byte contributes +1.
///
///   partial     ceil(count / 2) bytes; with an odd count the HIGH nibble of the
///               first byte is padding, must be zero, and is dropped
///   leaf        SCALE compact length + value bytes
///   branch      2 byte little-endian bitmap of child nibbles, then the value
///               when the header says so, then one SCALE compact reference per
///               set bit in ASCENDING nibble order. A reference of length 32 is
///               the hash of another node; any other length is an inline node.
///
/// Value before children is the order sp-trie actually writes, and it is the one
/// ordering bug found in this repository's server side decoder (audit P1 #1:
/// children read before value). test/SubstrateTrieVerifier.t.sol encodes the same
/// node in spec order and in the swapped order and asserts that only the spec
/// order decodes, so this contract cannot regress into the server's reading.
///
/// A branch with a hashed value carries its 32 byte hash with no compact length
/// prefix, and a hashed leaf is exactly header + partial + 32 bytes. That is what
/// the live proof set on Portaldot V3 shows and what lib/proofs.ts decodes.
///
/// # Statuses, and why a missing node is never "absent"
///
///   PROVEN          the walk reached a value committed by the root
///   ABSENT          the walk proved the key is NOT in the trie: it diverged on a
///                   partial key, ran out of branch children, or reached a leaf
///                   that ends before the key does. Absence is a positive proof.
///   INCOMPLETE      a node the parent references is not in the proof set, and
///                   every supplied node was reachable. The proof is truncated.
///   INVALID         a node does not decode, the set carries the same node
///                   twice, a hashed reference revisits a node (a cycle), or a
///                   walk that reached a value left a supplied node unreached
///                   (an extra node no reference on the path names).
///   ROOT_MISMATCH   no supplied node hashes to the state root.
///   VALUE_MISMATCH  a value was proven but it is not the value the caller claimed.
///
/// INCOMPLETE and ABSENT are different answers and callers treat them
/// differently: only ABSENT may ever authorise releasing backing.
contract SubstrateTrieVerifier is ITitleVerifier {
  /// @notice Operations a proof can authorise. The gate compares this with what
  /// it is about to do, so a transfer proof cannot authorise a burn.
  uint8 public constant OP_TRANSFER = 1;
  uint8 public constant OP_MINT = 2;
  uint8 public constant OP_BURN = 3;

  uint8 private constant KIND_EMPTY = 0;
  uint8 private constant KIND_LEAF = 1;
  uint8 private constant KIND_BRANCH = 2;
  uint8 private constant KIND_BRANCH_VALUE = 3;
  uint8 private constant KIND_HASHED_LEAF = 4;
  uint8 private constant KIND_HASHED_BRANCH = 5;

  uint256 private constant MAX_STEPS = 96;
  uint256 private constant MAX_NODES = 512;
  uint256 private constant NONE_INDEX = type(uint256).max;

  /// @notice The frozen location of title records on the native chain:
  /// twox128("LemoTitle") ++ twox128("CanonicalTitles"). A title's key is this
  /// prefix ++ blake2_128(titleId) ++ titleId (a Blake2_128Concat map), 80 bytes.
  /// Taken from the captured local runtime key in
  /// fixtures/lemo-local-capture.json (canonicalStorageKey). A storage layout
  /// migration that moves the map changes this constant, which is the point.
  bytes32 public constant CANONICAL_TITLES_PREFIX =
    0x4f03c24a87564f16d6105c855e7a6d375ec2a7664a464914b341c4ef2eeb96a0;
  uint256 public constant CANONICAL_TITLE_KEY_BYTES = 80;

  /// @dev _valueOf outcomes.
  uint8 private constant VALUE_OK = 0;
  uint8 private constant VALUE_MISSING = 1;
  uint8 private constant VALUE_INVALID = 2;

  IBlake2b256 public immutable hasher;

  error HasherIsZeroAddress();

  constructor(IBlake2b256 hasher_) {
    if (address(hasher_) == address(0)) revert HasherIsZeroAddress();
    hasher = hasher_;
  }

  // ---------------------------------------------------------------- public

  /// @notice Verify a key against a state root.
  /// @return status the verdict
  /// @return value the proven bytes when status is PROVEN, empty otherwise
  function verify(bytes32 stateRoot, bytes memory key, bytes[] calldata nodes)
    external
    view
    returns (Status status, bytes memory value)
  {
    return _verify(stateRoot, key, _copy(nodes), false, "");
  }

  /// @notice Verify a key and require the proven value to equal `expected`.
  /// @dev This is the call a gate makes when it already knows what the record
  /// should say: a proof of some other record is VALUE_MISMATCH, not PROVEN.
  function verifyValue(
    bytes32 stateRoot,
    bytes memory key,
    bytes[] calldata nodes,
    bytes memory expected
  ) external view returns (Status status, bytes memory value) {
    return _verify(stateRoot, key, _copy(nodes), true, expected);
  }

  /// @notice Verify a title proof and decode the proven native record.
  ///
  /// Binds the proof to the trie walk (state root), to the title id and
  /// revision the proof claims, to the chain id (record and this EVM), to the
  /// token contract (record evmContract) and to the title commitment (the
  /// decoded record must hash to the commitment the caller expects, which is
  /// what makes the individual fields non-substitutable).
  ///
  /// It also binds the storage key to the title id (audit M-01): the key must
  /// be 80 bytes, start with the frozen CanonicalTitles prefix and end with the
  /// title id, which is the Blake2_128Concat layout. The 16 bytes in between
  /// are blake2_128(titleId); they are NOT recomputed here, because the only
  /// hash the chain exposes to the EVM is blake2b-256 and a 128 bit digest is a
  /// different parameter block, not a truncation. Skipping them cannot move the
  /// proof to another title (the id is the key's own suffix and the decoded
  /// record must carry the same id), and a forged middle names a key whose
  /// value the root does not commit unless the chain wrote one there.
  ///
  /// It does not decide freshness (the root feed does) and it does not decide
  /// policy (the gate does: identity present, backing bound, operation match).
  function verifyTitle(TitleProof calldata proof, bytes32 expectedCommitment)
    external
    view
    override
    returns (Status status, TitleRecord memory record)
  {
    if (!_isCanonicalTitleKey(proof.storageKey, proof.titleId)) {
      return (Status.INVALID, record);
    }

    (Status walk, bytes memory blob) =
      _verify(proof.stateRoot, proof.storageKey, _copy(proof.nodes), false, "");
    if (walk != Status.PROVEN) return (walk, record);

    (bool decoded, TitleRecord memory r) = TitleLib.decodeNative(blob);
    if (!decoded) return (Status.INVALID, record);

    if (r.titleId != proof.titleId) return (Status.INVALID, record);
    if (r.revision != proof.revision) return (Status.INVALID, record);
    if (r.chainId != proof.chainId) return (Status.INVALID, record);
    if (r.chainId != block.chainid) return (Status.INVALID, record);
    if (r.evmContract != proof.token) return (Status.INVALID, record);
    if (TitleLib.hash(r) != expectedCommitment) return (Status.VALUE_MISMATCH, record);

    return (Status.PROVEN, r);
  }

  /// @notice True when `key` is the canonical CanonicalTitles key for `id`,
  /// apart from the blake2_128 middle (see verifyTitle).
  function isCanonicalTitleKey(bytes calldata key, bytes32 id) external pure returns (bool) {
    return _isCanonicalTitleKey(key, id);
  }

  function _isCanonicalTitleKey(bytes calldata key, bytes32 id) private pure returns (bool) {
    if (key.length != CANONICAL_TITLE_KEY_BYTES) return false;
    if (bytes32(key[0:32]) != CANONICAL_TITLES_PREFIX) return false;
    return bytes32(key[48:80]) == id;
  }

  /// @notice The versioned commitment a record hashes to.
  function commitmentOf(TitleRecord calldata record) external pure returns (bytes32) {
    return TitleLib.hash(record);
  }

  // ---------------------------------------------------------------- the walk

  struct Decoded {
    uint8 kind;
    uint256 nibbles;
    uint256 partialAt;
    uint256 valueAt;
    uint256 valueLen;
    bool valueIsHash;
    bool hasValue;
    uint16 bitmap;
    uint256 childAt;
  }

  /// @dev A resolved child reference: a hash when len is 32, inline otherwise.
  struct Child {
    bool found;
    uint256 at;
    uint256 len;
  }

  /// @dev SCALE compact length read: ok, the value, and the next offset.
  struct Compact {
    bool ok;
    uint256 value;
    uint256 next;
  }

  /// @dev Partial nibble count read: ok, the count, and the next offset.
  struct Count {
    bool ok;
    uint256 count;
    uint256 next;
  }

  /// @dev Walk state, bundled so the loop body does not exhaust the stack.
  struct Walk {
    bytes[] nodes;
    bytes32[] hashes;
    bool[] reached;
    bytes node;
    uint256 pos;
    uint256 total;
  }

  function _verify(
    bytes32 stateRoot,
    bytes memory key,
    bytes[] memory nodes,
    bool checkValue,
    bytes memory expected
  ) private view returns (Status, bytes memory) {
    if (nodes.length == 0) return (Status.INCOMPLETE, "");
    if (nodes.length > MAX_NODES) return (Status.INVALID, "");
    if (key.length == 0) return (Status.INVALID, "");

    bytes32[] memory hashes = new bytes32[](nodes.length);
    uint256 rootIndex = NONE_INDEX;
    for (uint256 i = 0; i < nodes.length; i += 1) {
      // Every node must be hashed exactly once; the loop is bounded by MAX_NODES.
      // forge-lint: disable-next-line(calls-loop)
      hashes[i] = hasher.hash(nodes[i]);
      // The same node twice makes the set ambiguous (_indexOf would silently
      // pick the first copy), so it is a malformed proof, not slack.
      for (uint256 j = 0; j < i; j += 1) {
        if (hashes[j] == hashes[i]) return (Status.INVALID, "");
      }
      if (hashes[i] == stateRoot && rootIndex == NONE_INDEX) rootIndex = i;
    }
    if (rootIndex == NONE_INDEX) return (Status.ROOT_MISMATCH, "");

    Walk memory w;
    w.nodes = nodes;
    w.hashes = hashes;
    w.reached = new bool[](nodes.length);
    w.reached[rootIndex] = true;
    w.node = nodes[rootIndex];
    w.pos = 0;
    w.total = key.length * 2;

    for (uint256 step = 0; step < MAX_STEPS; step += 1) {
      (Status status, bytes memory value, bool done) = _step(w, key, checkValue, expected);
      if (!done) continue;

      if (status == Status.PROVEN) {
        // Every supplied node must have been consumed by the walk. A node no
        // reference on the path names is a substitution attempt or a padded
        // set; neither is a proof of this key (audit L-09).
        for (uint256 i = 0; i < w.reached.length; i += 1) {
          if (!w.reached[i]) return (Status.INVALID, "");
        }
      }
      if (status != Status.NONE) return (status, value);

      // A referenced node is not in the set: the proof does not carry
      // everything the committed root requires. This is INCOMPLETE, and it
      // is never ABSENT. Note that a node whose bytes were substituted
      // reads the same way here, because the parent's reference no longer
      // resolves to anything supplied; the set alone cannot tell a
      // truncated proof from a substituted one, and both fail closed.
      return (Status.INCOMPLETE, "");
    }

    return (Status.INVALID, "");
  }

  /// @dev One node of the walk. done = false means the walk descended and the
  /// caller must step again.
  function _step(Walk memory w, bytes memory key, bool checkValue, bytes memory expected)
    private
    pure
    returns (Status, bytes memory, bool)
  {
    (bool ok, Decoded memory d) = _decode(w.node);
    if (!ok) return (Status.INVALID, "", true);
    if (d.kind == KIND_EMPTY) return (Status.ABSENT, "", true);
    if (d.nibbles > w.total - w.pos) return (Status.ABSENT, "", true);

    for (uint256 i = 0; i < d.nibbles; i += 1) {
      if (_partialNibble(w.node, d, i) != _keyNibble(key, w.pos + i)) {
        return (Status.ABSENT, "", true);
      }
    }
    w.pos += d.nibbles;

    if (d.kind == KIND_LEAF || d.kind == KIND_HASHED_LEAF) {
      if (w.pos != w.total) return (Status.ABSENT, "", true);
      (uint8 got, bytes memory leafValue) = _valueOf(w.node, d, w.hashes, w.nodes, w.reached);
      if (got == VALUE_INVALID) return (Status.INVALID, "", true);
      if (got == VALUE_MISSING) return (Status.NONE, "", true);
      (Status status, bytes memory value) = _finish(leafValue, checkValue, expected);
      return (status, value, true);
    }

    // Branch family. A value here only counts when the key ends exactly at
    // this node; otherwise the value is skipped and the walk descends.
    if (w.pos == w.total) {
      if (!d.hasValue) return (Status.ABSENT, "", true);
      (uint8 got, bytes memory branchValue) = _valueOf(w.node, d, w.hashes, w.nodes, w.reached);
      if (got == VALUE_INVALID) return (Status.INVALID, "", true);
      if (got == VALUE_MISSING) return (Status.NONE, "", true);
      (Status status, bytes memory value) = _finish(branchValue, checkValue, expected);
      return (status, value, true);
    }

    uint8 nibble = _keyNibble(key, w.pos);
    w.pos += 1;

    if (uint256(d.bitmap) & (uint256(1) << nibble) == 0) return (Status.ABSENT, "", true);

    return _descend(w, d, nibble);
  }

  /// @dev Follow the child reference under `nibble`. Kept separate from _step
  /// so neither frame carries the other's locals.
  function _descend(Walk memory w, Decoded memory d, uint8 nibble)
    private
    pure
    returns (Status, bytes memory, bool)
  {
    Child memory c = _childRef(w.node, d, nibble);
    if (!c.found) return (Status.INVALID, "", true);

    if (c.len == 32) {
      bytes32 childHash = _wordAt(w.node, c.at);
      uint256 childIndex = _indexOf(w.hashes, childHash);
      if (childIndex == NONE_INDEX) return (Status.NONE, "", true);
      if (w.reached[childIndex]) {
        // A cycle in a hash-linked trie is not a trie.
        return (Status.INVALID, "", true);
      }
      w.reached[childIndex] = true;
      w.node = w.nodes[childIndex];
    } else {
      w.node = _slice(w.node, c.at, c.len);
    }

    return (Status.NONE, "", false);
  }

  function _finish(bytes memory value, bool checkValue, bytes memory expected)
    private
    pure
    returns (Status, bytes memory)
  {
    if (checkValue && keccak256(value) != keccak256(expected)) {
      return (Status.VALUE_MISMATCH, value);
    }
    return (Status.PROVEN, value);
  }

  /// @dev Inline value: a slice of the node. Hashed value: the value node from
  /// the set, whose bytes hash to the reference the node carries.
  function _valueOf(
    bytes memory node,
    Decoded memory d,
    bytes32[] memory hashes,
    bytes[] memory nodes,
    bool[] memory reached
  ) private pure returns (uint8, bytes memory) {
    if (!d.valueIsHash) return (VALUE_OK, _slice(node, d.valueAt, d.valueLen));

    uint256 index = _indexOf(hashes, _wordAt(node, d.valueAt));
    if (index == NONE_INDEX) return (VALUE_MISSING, "");
    // Same rule as _descend: a node already on the path cannot also be the
    // value node (audit L-05).
    if (reached[index]) return (VALUE_INVALID, "");
    reached[index] = true;
    return (VALUE_OK, nodes[index]);
  }

  // ---------------------------------------------------------------- reading

  /// @dev Parse one node. Returns ok = false for anything malformed; callers
  /// turn that into INVALID. Every read is bounds checked and the node must be
  /// consumed exactly, so trailing bytes are a rejection rather than slack.
  function _decode(bytes memory node) private pure returns (bool, Decoded memory d) {
    if (node.length == 0) return (false, d);
    uint8 header = uint8(node[0]);

    if (header == 0x00) {
      if (node.length != 1) return (false, d);
      d.kind = KIND_EMPTY;
      return (true, d);
    }

    uint8 width;
    uint8 top = header & 0xc0;
    if (top == 0x40) {
      d.kind = KIND_LEAF;
      width = 6;
    } else if (top == 0x80) {
      d.kind = KIND_BRANCH;
      width = 6;
    } else if (top == 0xc0) {
      d.kind = KIND_BRANCH_VALUE;
      width = 6;
    } else if (header & 0xe0 == 0x20) {
      d.kind = KIND_HASHED_LEAF;
      width = 5;
    } else if (header & 0xf0 == 0x10) {
      d.kind = KIND_HASHED_BRANCH;
      width = 4;
    } else {
      return (false, d);
    }

    Count memory n = _nibbleCount(node, width);
    if (!n.ok) return (false, d);
    d.nibbles = n.count;
    d.partialAt = n.next;

    uint256 byteCount = (n.count + 1) / 2;
    if (n.next + byteCount > node.length) return (false, d);
    if (n.count % 2 == 1 && uint8(node[n.next]) >> 4 != 0) return (false, d);

    uint256 at = n.next + byteCount;

    if (d.kind == KIND_LEAF || d.kind == KIND_HASHED_LEAF) {
      if (d.kind == KIND_HASHED_LEAF) {
        if (at + 32 != node.length) return (false, d);
        d.hasValue = true;
        d.valueIsHash = true;
        d.valueAt = at;
        d.valueLen = 32;
        return (true, d);
      }
      Compact memory leafRef = _compact(node, at);
      if (!leafRef.ok) return (false, d);
      if (leafRef.next + leafRef.value != node.length) return (false, d);
      d.hasValue = true;
      d.valueAt = leafRef.next;
      d.valueLen = leafRef.value;
      return (true, d);
    }

    // Branch family: bitmap, then the value if the header claims one, then
    // children in ascending nibble order.
    if (at + 2 > node.length) return (false, d);
    d.bitmap = uint16(uint8(node[at])) | (uint16(uint8(node[at + 1])) << 8);
    at += 2;

    if (d.kind == KIND_BRANCH_VALUE || d.kind == KIND_HASHED_BRANCH) {
      if (d.kind == KIND_HASHED_BRANCH) {
        if (at + 32 > node.length) return (false, d);
        d.hasValue = true;
        d.valueIsHash = true;
        d.valueAt = at;
        d.valueLen = 32;
        at += 32;
      } else {
        Compact memory branchRef = _compact(node, at);
        if (!branchRef.ok) return (false, d);
        if (branchRef.value == 0) return (false, d);
        if (branchRef.next + branchRef.value > node.length) return (false, d);
        d.hasValue = true;
        d.valueAt = branchRef.next;
        d.valueLen = branchRef.value;
        at = branchRef.next + branchRef.value;
      }
    }

    d.childAt = at;

    uint256 cursor = at;
    for (uint256 nibble = 0; nibble < 16; nibble += 1) {
      if (uint256(d.bitmap) & (uint256(1) << nibble) == 0) continue;
      Compact memory childRef = _compact(node, cursor);
      if (!childRef.ok) return (false, d);
      if (childRef.value == 0) return (false, d);
      if (childRef.next + childRef.value > node.length) return (false, d);
      cursor = childRef.next + childRef.value;
    }
    if (cursor != node.length) return (false, d);

    return (true, d);
  }

  /// @dev Partial nibble count, including the continuation byte form.
  function _nibbleCount(bytes memory node, uint8 width) private pure returns (Count memory n) {
    uint256 max = uint256(0xff) >> (8 - width);
    uint256 remainder = uint256(uint8(node[0])) & max;

    if (remainder < max) {
      n.ok = true;
      n.count = remainder;
      n.next = 1;
      return n;
    }

    remainder -= 1;
    uint256 next = 1;
    while (next < node.length) {
      uint256 octet = uint256(uint8(node[next]));
      next += 1;
      if (octet == 0xff) {
        remainder += 255;
        continue;
      }
      n.ok = true;
      n.count = remainder + octet + 1;
      n.next = next;
      return n;
    }
    return n;
  }

  /// @dev SCALE compact length. Mode 0b11 (big integer) is not a node length.
  function _compact(bytes memory node, uint256 at) private pure returns (Compact memory c) {
    if (at >= node.length) return c;
    uint8 first = uint8(node[at]);
    uint8 mode = first & 0x03;

    if (mode == 0) {
      c.ok = true;
      c.value = uint256(first) >> 2;
      c.next = at + 1;
      return c;
    }

    if (mode == 1) {
      if (at + 2 > node.length) return c;
      uint256 two = uint256(first) | (uint256(uint8(node[at + 1])) << 8);
      c.ok = true;
      c.value = (two >> 2) & 0x3fff;
      c.next = at + 2;
      return c;
    }

    if (mode == 2) {
      if (at + 4 > node.length) return c;
      uint256 four = uint256(uint8(node[at])) | (uint256(uint8(node[at + 1])) << 8)
        | (uint256(uint8(node[at + 2])) << 16) | (uint256(uint8(node[at + 3])) << 24);
      c.ok = true;
      c.value = four >> 2;
      c.next = at + 4;
      return c;
    }

    return c;
  }

  /// @dev Locate the reference for `nibble` without reading past the earlier
  /// siblings, so the ascending order is enforced by construction.
  function _childRef(bytes memory node, Decoded memory d, uint8 nibble)
    private
    pure
    returns (Child memory c)
  {
    uint256 cursor = d.childAt;
    for (uint256 i = 0; i < 16; i += 1) {
      if (uint256(d.bitmap) & (uint256(1) << i) == 0) continue;
      Compact memory ref = _compact(node, cursor);
      if (!ref.ok) return c;
      if (i == nibble) {
        c.found = true;
        c.at = ref.next;
        c.len = ref.value;
        return c;
      }
      cursor = ref.next + ref.value;
    }
    return c;
  }

  function _partialNibble(bytes memory node, Decoded memory d, uint256 i)
    private
    pure
    returns (uint8)
  {
    uint256 j = (d.nibbles % 2 == 1) ? i + 1 : i;
    uint8 packed = uint8(node[d.partialAt + j / 2]);
    return (j % 2 == 0) ? (packed >> 4) : (packed & 0x0f);
  }

  function _keyNibble(bytes memory key, uint256 i) private pure returns (uint8) {
    uint8 packed = uint8(key[i / 2]);
    return (i % 2 == 0) ? (packed >> 4) : (packed & 0x0f);
  }

  function _indexOf(bytes32[] memory hashes, bytes32 wanted) private pure returns (uint256) {
    for (uint256 i = 0; i < hashes.length; i += 1) {
      if (hashes[i] == wanted) return i;
    }
    return NONE_INDEX;
  }

  function _wordAt(bytes memory node, uint256 at) private pure returns (bytes32 word) {
    assembly {
      word := mload(add(add(node, 0x20), at))
    }
  }

  function _slice(bytes memory data, uint256 at, uint256 len)
    private
    pure
    returns (bytes memory out)
  {
    out = new bytes(len);
    for (uint256 i = 0; i < len; i += 1) {
      out[i] = data[at + i];
    }
  }

  function _copy(bytes[] calldata nodes) private pure returns (bytes[] memory out) {
    out = new bytes[](nodes.length);
    for (uint256 i = 0; i < nodes.length; i += 1) {
      out[i] = nodes[i];
    }
  }

  function _toBytes(bytes32 value) private pure returns (bytes memory out) {
    out = new bytes(32);
    assembly {
      mstore(add(out, 0x20), value)
    }
  }
}
