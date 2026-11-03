// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IBlake2b256 } from "./IBlake2b256.sol";

/// @title ReviveBlake2b256
/// @notice blake2_256 through the pallet-revive System precompile.
///
/// The precompile lives at 0x0000000000000000000000000000000000000900 on
/// Portaldot V3 (chain id 420420777, the test endpoint). Its Solidity-facing
/// surface is declared in polkadot-sdk's `pallet_revive::precompiles::system`
/// `sol!` block, and the function this contract calls is:
///
///     function hashBlake256(bytes input) external view returns (bytes32);
///     selector 0xc7dff686
///
/// Verified live against https://test-evm-rpc-v3.portaldot.dev with
/// eth_call {"to":"0x...0900","data":"0xc7dff686 <abi(bytes 'abc')>"}:
/// it returned 0xbddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8e...
/// which is BLAKE2b-256("abc"). A control call with a wrong selector
/// (`hash(bytes)`, 0xaa1e84de) reverted inside the precompile with
/// `panic: memory allocation error`, which is how an unimplemented selector
/// fails there, so the selector is not interchangeable.
///
/// The selector is written literally and asserted in
/// test/Blake2b256.t.sol rather than trusted: `cast sig "hashBlake256(bytes)"`
/// prints 0xc7dff686.
contract ReviveBlake2b256 is IBlake2b256 {
  address public constant SYSTEM_PRECOMPILE = 0x0000000000000000000000000000000000000900;
  bytes4 public constant HASH_BLAKE_256_SELECTOR = 0xc7dff686;
  /// @notice Gas forwarded to the precompile per hash (audit L-03). A broken
  /// or hostile precompile can burn at most this much, not the whole call
  /// budget; running out reads as a failed call and reverts below.
  uint256 public constant STATIC_CALL_GAS = 100_000;

  error HashCallFailed();

  /// @inheritdoc IBlake2b256
  function hash(bytes memory data) external view returns (bytes32 out) {
    (bool ok, bytes memory ret) = SYSTEM_PRECOMPILE.staticcall{ gas: STATIC_CALL_GAS }(
      abi.encodeWithSelector(HASH_BLAKE_256_SELECTOR, data)
    );
    // Fail closed: a precompile that is absent (a local EVM, a fork, a
    // chain that has not enabled Revive) must revert, never return zero.
    if (!ok || ret.length != 32) revert HashCallFailed();
    out = abi.decode(ret, (bytes32));
  }
}
