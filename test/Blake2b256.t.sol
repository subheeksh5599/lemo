// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Blake2b256 } from "./harness/Blake2b256.sol";
import { TestBlake2b } from "./harness/TestBlake2b.sol";

/// @title Blake2b256Test
/// @notice Known-answer tests for the pure Solidity BLAKE2b-256 port.
///
/// The digests below were produced by Python's hashlib.blake2b(digest_size=32),
/// an implementation independent of both this port and Substrate. The "abc"
/// row is additionally the exact value the Revive precompile at 0x...0900
/// returned to a live eth_call, so the port, Python and the chain agree.
contract Blake2b256Test is Test {
  TestBlake2b internal hasher;

  function setUp() public {
    hasher = new TestBlake2b();
  }

  function test_EmptyDigest() public pure {
    assertEq(
      Blake2b256.hash(""),
      bytes32(0x0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8)
    );
  }

  function test_AbcMatchesTheChain() public pure {
    // Cross-checked against the live System precompile: the same input
    // returned bddd813c... from 0x...0900 over eth_call.
    assertEq(
      Blake2b256.hash("abc"),
      bytes32(0xbddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319)
    );
  }

  function test_BlockBoundaries() public pure {
    // 127 bytes (single, padded final block)
    assertEq(
      Blake2b256.hash(_range(127)),
      bytes32(0xf2fe67ff342e21b8f45e8f2e0bcd1d9243245d50ee6c78042e9c491388791c72)
    );
    // 128 bytes (single full block, final flag set)
    assertEq(
      Blake2b256.hash(_range(128)),
      bytes32(0xc3582f71ebb2be66fa5dd750f80baae97554f3b015663c8be377cfcb2488c1d1)
    );
    // 129 bytes (one full block, then a 1 byte final block)
    assertEq(
      Blake2b256.hash(_range(129)),
      bytes32(0xf7f3c46ba2564ff4c4c162da1f5b605f9f1c4aa6a20652a9f9a337c1a2f5b9c9)
    );
    // 1000 bytes (eight blocks, the last one padded)
    assertEq(
      Blake2b256.hash(_repeat(_range(250), 4)),
      bytes32(0xc032e2c19d5eebcbc7e89a5051418a7da426ac6bd491df02703adaf9693ec203)
    );
  }

  /// @notice The injected-call shape the verifier uses must agree with the
  /// in-process one: same bytes in, same digest out.
  function test_InjectedCallMatchesLibrary() public view {
    bytes memory payload = hex"c0ffee";
    assertEq(hasher.hash(payload), Blake2b256.hash(payload));
    assertEq(hasher.hashMemory(payload), Blake2b256.hash(payload));
  }

  function test_FuzzAgreesWithItself() public view {
    bytes memory a = abi.encodePacked(block.timestamp, msg.sender);
    assertEq(hasher.hash(a), Blake2b256.hash(a));
  }

  function _range(uint256 n) private pure returns (bytes memory out) {
    out = new bytes(n);
    for (uint256 i = 0; i < n; i += 1) {
      out[i] = bytes1(uint8(i % 256));
    }
  }

  function _repeat(bytes memory unit, uint256 times) private pure returns (bytes memory out) {
    out = new bytes(unit.length * times);
    for (uint256 t = 0; t < times; t += 1) {
      for (uint256 i = 0; i < unit.length; i += 1) {
        out[t * unit.length + i] = unit[i];
      }
    }
  }
}
