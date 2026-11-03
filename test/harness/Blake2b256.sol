// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title Blake2b256
/// @notice A compact, dependency free BLAKE2b with a 32 byte digest, unkeyed.
///
/// This exists so the test suite can hash for real. It is the algorithm
/// Substrate calls blake2_256 (the state trie hasher and the input to
/// `System::hashBlake256` on the Revive precompile), so a proof verified in
/// this repository is verified against the same bytes the chain produced.
///
/// Verified against Python's hashlib.blake2b(digest_size=32) on the empty
/// string, "abc", a 127 byte payload, a 128 byte block, 129 bytes and 1000
/// bytes. See test/Blake2b256.t.sol and shared/blake2b-vectors.json.
///
/// It is NOT production code: it costs far more gas than the chain's native
/// precompile. Deployed contracts must use ReviveBlake2b256 (the 0x...0900
/// System precompile) instead.
library Blake2b256 {
  // IV, the first 64 bits of the fractional parts of the square roots of the
  // first eight primes.
  uint64 private constant IV0 = 0x6a09e667f3bcc908;
  uint64 private constant IV1 = 0xbb67ae8584caa73b;
  uint64 private constant IV2 = 0x3c6ef372fe94f82b;
  uint64 private constant IV3 = 0xa54ff53a5f1d36f1;
  uint64 private constant IV4 = 0x510e527fade682d1;
  uint64 private constant IV5 = 0x9b05688c2b3e6c1f;
  uint64 private constant IV6 = 0x1f83d9abfb41bd6b;
  uint64 private constant IV7 = 0x5be0cd19137e2179;

  // The 12 round permutations, 16 bytes per round, flattened.
  bytes private constant SIGMA = hex"000102030405060708090a0b0c0d0e0f"
    hex"0e0a0408090f0d06010c00020b070503" hex"0b080c0005020f0d0a0e030607010904"
    hex"070903010d0c0b0e0206050a04000f08" hex"0900050702040a0f0e010b0c0608030d"
    hex"020c060a000b0803040d07050f0e0109" hex"0c05010f0e0d040a000706030902080b"
    hex"0d0b070e0c01030905000f040806020a" hex"060f0e090b0300080c020d0701040a05"
    hex"0a020804070601050f0b090e030c0d00" hex"000102030405060708090a0b0c0d0e0f"
    hex"0e0a0408090f0d06010c00020b070503";

  /// @notice BLAKE2b-256 of `data`.
  function hash(bytes memory data) internal pure returns (bytes32) {
    uint64[8] memory h = _digest(data, 32);
    uint256 acc;
    // A 32 byte digest is the little-endian encoding of h[0..3]; h[4..7]
    // are dropped by the truncation BLAKE2b specifies for dkLen = 32.
    for (uint256 i = 0; i < 4; i += 1) {
      acc |= uint256(_bswap64(h[i])) << (192 - 64 * i);
    }
    return bytes32(acc);
  }

  /// @notice BLAKE2b-128 of `data` (Substrate's blake2_128, the hash inside a
  /// Blake2_128Concat map key). The digest length is part of the parameter
  /// block, so this is not a truncation of `hash`.
  function hash128(bytes memory data) internal pure returns (bytes16) {
    uint64[8] memory h = _digest(data, 16);
    uint128 acc = (uint128(_bswap64(h[0])) << 64) | uint128(_bswap64(h[1]));
    return bytes16(acc);
  }

  function _digest(bytes memory data, uint64 outLen) private pure returns (uint64[8] memory h) {
    // Parameter block folded into h[0]: digest length, key length 0, fanout 1,
    // depth 1.
    h[0] = IV0 ^ (0x01010000 | outLen);
    h[1] = IV1;
    h[2] = IV2;
    h[3] = IV3;
    h[4] = IV4;
    h[5] = IV5;
    h[6] = IV6;
    h[7] = IV7;

    uint256 len = data.length;

    if (len == 0) {
      _compress(h, _zeroBlock(), 0, 0, true);
    } else {
      uint256 offset = 0;
      while (offset < len) {
        uint256 remaining = len - offset;
        if (remaining > 128) {
          _compress(h, data, offset, uint128(offset + 128), false);
          offset += 128;
        } else {
          // Final block: zero padded, counter is the total length.
          _compress(h, _pad(data, offset, remaining), 0, uint128(len), true);
          offset += remaining;
        }
      }
    }
  }

  function _zeroBlock() private pure returns (bytes memory) {
    return new bytes(128);
  }

  /// @dev A 128 byte copy of the tail of `data`, zero padded.
  function _pad(bytes memory data, uint256 offset, uint256 length)
    private
    pure
    returns (bytes memory)
  {
    bytes memory chunk = new bytes(128);
    for (uint256 i = 0; i < length; i += 1) {
      chunk[i] = data[offset + i];
    }
    return chunk;
  }

  function _load64(bytes memory data, uint256 offset) private pure returns (uint64 word) {
    unchecked {
      for (uint256 i = 0; i < 8; i += 1) {
        word |= uint64(uint256(uint8(data[offset + i])) << (8 * i));
      }
    }
  }

  function _compress(
    uint64[8] memory h,
    bytes memory chunk,
    uint256 blockOffset,
    uint128 counter,
    bool isLast
  ) private pure {
    unchecked {
      uint64[16] memory v;
      for (uint256 i = 0; i < 8; i += 1) {
        v[i] = h[i];
      }
      v[8] = IV0;
      v[9] = IV1;
      v[10] = IV2;
      v[11] = IV3;
      v[12] = IV4 ^ uint64(counter);
      v[13] = IV5 ^ uint64(counter >> 64);
      v[14] = isLast ? (IV6 ^ 0xffffffffffffffff) : IV6;
      v[15] = IV7;

      for (uint256 round = 0; round < 12; round += 1) {
        _round(v, chunk, blockOffset, round * 16);
      }

      for (uint256 i = 0; i < 8; i += 1) {
        h[i] = h[i] ^ v[i] ^ v[i + 8];
      }
    }
  }

  /// @dev One BLAKE2b round: four column steps then four diagonal steps.
  function _round(uint64[16] memory v, bytes memory chunk, uint256 blockOffset, uint256 base)
    private
    pure
  {
    _g(v, 0, 4, 8, 12, _msg(chunk, blockOffset, base, 0), _msg(chunk, blockOffset, base, 1));
    _g(v, 1, 5, 9, 13, _msg(chunk, blockOffset, base, 2), _msg(chunk, blockOffset, base, 3));
    _g(v, 2, 6, 10, 14, _msg(chunk, blockOffset, base, 4), _msg(chunk, blockOffset, base, 5));
    _g(v, 3, 7, 11, 15, _msg(chunk, blockOffset, base, 6), _msg(chunk, blockOffset, base, 7));
    _g(v, 0, 5, 10, 15, _msg(chunk, blockOffset, base, 8), _msg(chunk, blockOffset, base, 9));
    _g(v, 1, 6, 11, 12, _msg(chunk, blockOffset, base, 10), _msg(chunk, blockOffset, base, 11));
    _g(v, 2, 7, 8, 13, _msg(chunk, blockOffset, base, 12), _msg(chunk, blockOffset, base, 13));
    _g(v, 3, 4, 9, 14, _msg(chunk, blockOffset, base, 14), _msg(chunk, blockOffset, base, 15));
  }

  /// @dev Message word `k` of a round, permuted through SIGMA.
  function _msg(bytes memory chunk, uint256 blockOffset, uint256 base, uint256 k)
    private
    pure
    returns (uint64)
  {
    return _load64(chunk, blockOffset + 8 * uint256(uint8(SIGMA[base + k])));
  }

  function _g(uint64[16] memory v, uint256 a, uint256 b, uint256 c, uint256 d, uint64 x, uint64 y)
    private
    pure
  {
    unchecked {
      v[a] = v[a] + v[b] + x;
      v[d] = _rotr(v[d] ^ v[a], 32);
      v[c] = v[c] + v[d];
      v[b] = _rotr(v[b] ^ v[c], 24);
      v[a] = v[a] + v[b] + y;
      v[d] = _rotr(v[d] ^ v[a], 16);
      v[c] = v[c] + v[d];
      v[b] = _rotr(v[b] ^ v[c], 63);
    }
  }

  function _rotr(uint64 x, uint256 n) private pure returns (uint64) {
    unchecked {
      return uint64((uint256(x) >> n) | (uint256(x) << (64 - n)));
    }
  }

  function _bswap64(uint64 x) private pure returns (uint64) {
    unchecked {
      return ((x & 0x00000000000000ff) << 56) | ((x & 0x000000000000ff00) << 40)
        | ((x & 0x0000000000ff0000) << 24) | ((x & 0x00000000ff000000) << 8)
        | ((x & 0x000000ff00000000) >> 8) | ((x & 0x0000ff0000000000) >> 24)
        | ((x & 0x00ff000000000000) >> 40) | ((x & 0xff00000000000000) >> 56);
    }
  }
}
