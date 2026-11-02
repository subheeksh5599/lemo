// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { TitleGateBase } from "./TitleGateBase.sol";
import { TitleRecord } from "./LemoTitle.sol";
import { ITitleVerifier } from "./ITitleVerifier.sol";
import { IRootFeed } from "./IRootFeed.sol";

interface IERC721Receiver {
  function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
    external
    returns (bytes4);
}

/// @title TitleGateERC721
/// @notice A unique representation of one LEMO title. Every movement of the
/// token, and every mint or burn, needs a proof of the native title at the root
/// the feed holds.
///
/// One token per title, so `tokenId` is fixed at 1 and cannot be re-used: the
/// token represents the title, not an edition of it.
contract TitleGateERC721 is TitleGateBase {
  string public name;
  string public symbol;
  uint256 public constant TOKEN_ID = 1;

  uint256 public totalSupply;

  mapping(uint256 => address) private _ownerOf;
  mapping(address => uint256) public balanceOf;
  mapping(uint256 => address) public getApproved;
  mapping(address => mapping(address => bool)) public isApprovedForAll;

  event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
  event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
  event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

  error NotTokenOwner(address caller, uint256 tokenId);
  error NotAuthorised(address caller, uint256 tokenId);
  error TokenExists(uint256 tokenId);
  error NoSuchToken(uint256 tokenId);
  error UnsafeRecipient(address recipient);

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

  /// @notice Mint the representation. Needs a mint proof.
  function mint(address to, ITitleVerifier.TitleProof calldata proof) external {
    if (to == address(0)) revert UnsafeRecipient(to);
    if (_ownerOf[TOKEN_ID] != address(0)) revert TokenExists(TOKEN_ID);
    TitleRecord memory record = _gate(OP_MINT, keccak256(abi.encode(to)), proof);
    if (to != record.owner) revert RecipientNotProven(record.owner, to);
    totalSupply = 1;
    _ownerOf[TOKEN_ID] = to;
    balanceOf[to] += 1;
    emit Transfer(address(0), to, TOKEN_ID);
  }

  /// @notice Burn the representation. Needs a burn proof, and only the owner
  /// or an approved operator may ask for it.
  function burn(ITitleVerifier.TitleProof calldata proof) external {
    address holder = _requireExisting();
    if (msg.sender != holder && !isApprovedForAll[holder][msg.sender]) {
      revert NotAuthorised(msg.sender, TOKEN_ID);
    }
    _gate(OP_BURN, keccak256(abi.encode(holder)), proof);
    totalSupply = 0;
    _ownerOf[TOKEN_ID] = address(0);
    balanceOf[holder] -= 1;
    delete getApproved[TOKEN_ID];
    emit Transfer(holder, address(0), TOKEN_ID);
  }

  /// @notice Move the token. Needs a transfer proof. This is the single
  /// transfer entry point: `safeTransferFrom` delegates to it.
  function transferFrom(
    address from,
    address to,
    uint256 tokenId,
    ITitleVerifier.TitleProof calldata proof
  ) external {
    _transfer(from, to, tokenId);
    // The gate runs after the authorisation checks and before any state
    // change: _transfer above only validates, it writes nothing.
    _gate(OP_TRANSFER, keccak256(abi.encode(from, to, tokenId)), proof);
    _ownerOf[tokenId] = to;
    balanceOf[from] -= 1;
    balanceOf[to] += 1;
    delete getApproved[tokenId];
    emit Transfer(from, to, tokenId);
  }

  function safeTransferFrom(
    address from,
    address to,
    uint256 tokenId,
    ITitleVerifier.TitleProof calldata proof
  ) external {
    _transfer(from, to, tokenId);
    _gate(OP_TRANSFER, keccak256(abi.encode(from, to, tokenId)), proof);
    _ownerOf[tokenId] = to;
    balanceOf[from] -= 1;
    balanceOf[to] += 1;
    delete getApproved[tokenId];
    emit Transfer(from, to, tokenId);
    _checkReceiver(from, to, tokenId);
  }

  function safeTransferFrom(
    address from,
    address to,
    uint256 tokenId,
    bytes calldata data,
    ITitleVerifier.TitleProof calldata proof
  ) external {
    _transfer(from, to, tokenId);
    _gate(OP_TRANSFER, keccak256(abi.encode(from, to, tokenId)), proof);
    _ownerOf[tokenId] = to;
    balanceOf[from] -= 1;
    balanceOf[to] += 1;
    delete getApproved[tokenId];
    emit Transfer(from, to, tokenId);
    _checkReceiverWithData(from, to, tokenId, data);
  }

  // ---------------------------------------------------------------- ungated

  function ownerOf(uint256 tokenId) external view returns (address) {
    address holder = _ownerOf[tokenId];
    if (holder == address(0)) revert NoSuchToken(tokenId);
    return holder;
  }

  function approve(address spender, uint256 tokenId) external {
    address holder = _requireExisting();
    if (msg.sender != holder && !isApprovedForAll[holder][msg.sender]) {
      revert NotAuthorised(msg.sender, tokenId);
    }
    getApproved[tokenId] = spender;
    emit Approval(holder, spender, tokenId);
  }

  function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
    return interfaceId == 0x01ffc9a7 || interfaceId == 0x80ac58cd;
  }

  function setApprovalForAll(address operator, bool approved) external {
    isApprovedForAll[msg.sender][operator] = approved;
    emit ApprovalForAll(msg.sender, operator, approved);
  }

  /// @inheritdoc TitleGateBase
  function representationOutstanding() public view override(TitleGateBase) returns (bool) {
    return totalSupply > 0;
  }

  // ---------------------------------------------------------------- internal

  function _requireExisting() private view returns (address holder) {
    holder = _ownerOf[TOKEN_ID];
    if (holder == address(0)) revert NoSuchToken(TOKEN_ID);
  }

  function _transfer(address from, address to, uint256 tokenId) private view {
    address holder = _ownerOf[tokenId];
    if (holder == address(0)) revert NoSuchToken(tokenId);
    if (holder != from) revert NotTokenOwner(from, tokenId);
    if (to == address(0)) revert UnsafeRecipient(to);
    if (to == from) revert SameOwnerAndRecipient();
    if (
      msg.sender != holder && msg.sender != getApproved[tokenId]
        && !isApprovedForAll[holder][msg.sender]
    ) {
      revert NotAuthorised(msg.sender, tokenId);
    }
  }

  function _checkReceiver(address from, address to, uint256 tokenId) private {
    if (to.code.length == 0) return;
    try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, "") returns (bytes4 ret) {
      if (ret != IERC721Receiver.onERC721Received.selector) revert UnsafeRecipient(to);
    } catch {
      revert UnsafeRecipient(to);
    }
  }

  function _checkReceiverWithData(address from, address to, uint256 tokenId, bytes calldata data)
    private
  {
    if (to.code.length == 0) return;
    try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) returns (bytes4 ret) {
      if (ret != IERC721Receiver.onERC721Received.selector) revert UnsafeRecipient(to);
    } catch {
      revert UnsafeRecipient(to);
    }
  }
}
