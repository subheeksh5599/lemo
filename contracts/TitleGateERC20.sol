// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { TitleGateBase } from "./TitleGateBase.sol";
import { ITitleVerifier } from "./ITitleVerifier.sol";
import { IRootFeed } from "./IRootFeed.sol";

/// @title TitleGateERC20
/// @notice A fungible representation of one LEMO title, where every movement
/// needs a proof of the native title at the root the feed holds.
///
/// Gated: `transfer`, `transferFrom`, `mint`, `burn`. NOT gated: `approve` and
/// `setApprovalForAll` style bookkeeping, because they move nothing; an approval
/// is only spendable through `transferFrom`, which is gated.
///
/// A transfer to yourself is refused rather than treated as a no-op, because a
/// no-op that consumes a nullifier is a trap: it would burn the authorisation
/// and move nothing.
contract TitleGateERC20 is TitleGateBase {
  string public name;
  string public symbol;
  uint8 public constant decimals = 18;

  uint256 public totalSupply;

  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public allowance;

  event Transfer(address indexed from, address indexed to, uint256 amount);
  event Approval(address indexed owner, address indexed spender, uint256 amount);

  error InsufficientBalance(address owner, uint256 balance, uint256 needed);
  error InsufficientAllowance(address spender, uint256 allowed, uint256 needed);
  error ZeroAmount();

  constructor(
    ITitleVerifier verifier_,
    IRootFeed feed_,
    bytes32 titleId_,
    bytes32 titleCommitment_,
    address owner_,
    string memory name_,
    string memory symbol_
  ) TitleGateBase(verifier_, feed_, titleId_, titleCommitment_, owner_) {
    name = name_;
    symbol = symbol_;
  }

  // ------------------------------------------------------------------ gated

  /// @notice Move your own tokens. Needs a transfer proof.
  function transfer(address to, uint256 amount, ITitleVerifier.TitleProof calldata proof)
    external
    returns (bool)
  {
    if (to == msg.sender) revert SameOwnerAndRecipient();
    _gate(OP_TRANSFER, proof);
    _transfer(msg.sender, to, amount);
    return true;
  }

  /// @notice Move tokens on someone else's behalf. Needs its own transfer
  /// proof: an approval alone cannot move anything.
  function transferFrom(
    address from,
    address to,
    uint256 amount,
    ITitleVerifier.TitleProof calldata proof
  ) external returns (bool) {
    _gate(OP_TRANSFER, proof);

    uint256 allowed = allowance[from][msg.sender];
    if (allowed != type(uint256).max) {
      if (allowed < amount) revert InsufficientAllowance(msg.sender, allowed, amount);
      unchecked {
        allowance[from][msg.sender] = allowed - amount;
      }
      emit Approval(from, msg.sender, allowance[from][msg.sender]);
    }

    _transfer(from, to, amount);
    return true;
  }

  /// @notice Create representation. Needs a mint proof of a title that is
  /// bound and backed. This is the "mint without backing" path that must fail.
  function mint(address to, uint256 amount, ITitleVerifier.TitleProof calldata proof) external {
    _gate(OP_MINT, proof);
    _mint(to, amount);
  }

  /// @notice Destroy representation. Needs a burn proof, so a burn cannot be
  /// used to satisfy the native side without the native side agreeing.
  function burn(address from, uint256 amount, ITitleVerifier.TitleProof calldata proof) external {
    _gate(OP_BURN, proof);
    _burn(from, amount);
  }

  // ---------------------------------------------------------------- ungated

  function approve(address spender, uint256 amount) external returns (bool) {
    allowance[msg.sender][spender] = amount;
    emit Approval(msg.sender, spender, amount);
    return true;
  }

  /// @inheritdoc TitleGateBase
  function representationOutstanding() public view override(TitleGateBase) returns (bool) {
    return totalSupply > 0;
  }

  // ---------------------------------------------------------------- internal

  function _transfer(address from, address to, uint256 amount) private {
    if (amount == 0) revert ZeroAmount();
    uint256 balance = balanceOf[from];
    if (balance < amount) revert InsufficientBalance(from, balance, amount);
    unchecked {
      balanceOf[from] = balance - amount;
    }
    balanceOf[to] += amount;
    emit Transfer(from, to, amount);
  }

  function _mint(address to, uint256 amount) private {
    if (amount == 0) revert ZeroAmount();
    totalSupply += amount;
    balanceOf[to] += amount;
    emit Transfer(address(0), to, amount);
  }

  function _burn(address from, uint256 amount) private {
    if (amount == 0) revert ZeroAmount();
    uint256 balance = balanceOf[from];
    if (balance < amount) revert InsufficientBalance(from, balance, amount);
    unchecked {
      balanceOf[from] = balance - amount;
      totalSupply -= amount;
    }
    emit Transfer(from, address(0), amount);
  }
}
