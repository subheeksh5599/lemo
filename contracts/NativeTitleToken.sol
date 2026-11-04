// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// The trie walk of the deployed SubstrateTrieVerifier (status 1 = PROVEN).
interface ITrieVerify {
  function verify(bytes32 stateRoot, bytes memory key, bytes[] calldata nodes)
    external
    view
    returns (uint8 status, bytes memory value);
}

/// The validator-signed root, as BeefyRootFeed stores it.
interface IRootFeed {
  function currentRoot() external view returns (bytes32);
  function currentBlockNumber() external view returns (uint256);
}

/// @title NativeTitleToken
/// @notice An ERC-20 whose supply exists only while a native Portaldot NFT says so.
///
/// The native title is an item of the public `nfts` pallet. Its storage entry
/// `Nfts::Item(collection, item)` starts with the owner's AccountId32. Every
/// rule below is checked against that entry, proven from the state root that
/// both BEEFY validators signed (BeefyRootFeed); no key, owner or attester can
/// stand in for the proof.
///
///  - claim: the native owner's own mapped EVM account mints UNITS once per item.
///  - freeze: anyone proves the item is gone or owned by someone else; the
///    representation stops moving. The EVM side obeys the native side.
///  - burn: always allowed for a holder, frozen or not, so supply can return to zero.
contract NativeTitleToken {
  string public constant name = "LEMO Native Title";
  string public constant symbol = "LNT";
  uint8 public constant decimals = 18;
  uint256 public constant UNITS = 1000e18;

  /// twox128("Nfts") ++ twox128("Item")
  bytes32 private constant ITEM_PREFIX = 0xe8d49389c2e23e152fdd6364daadd2cce6636c7091b616c035068763633f33e2;

  IRootFeed public immutable feed;
  ITrieVerify public immutable verifier;

  uint256 public totalSupply;
  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public allowance;

  struct Title {
    bytes32 owner; // native AccountId32 that claimed
    uint256 outstanding; // representation still in circulation
    uint256 claimedAt; // feed block of the claim proof
    bool claimed;
    bool frozen;
  }

  /// keccak256(collection, item) => title
  mapping(bytes32 => Title) public titles;
  /// which title a holder's balance belongs to (one title per holder keeps the freeze exact)
  mapping(address => bytes32) public titleOf;

  event Transfer(address indexed from, address indexed to, uint256 value);
  event Approval(address indexed owner, address indexed spender, uint256 value);
  event Claimed(uint32 indexed collection, uint32 indexed item, bytes32 owner, address to, uint256 rootBlock);
  event Frozen(uint32 indexed collection, uint32 indexed item, uint256 rootBlock, bool absent);

  error BadKey();
  error NotProven(uint8 status);
  error NotTheNativeOwner(address expected);
  error AlreadyClaimed();
  error NotClaimed();
  error StillHeld();
  error TitleFrozen();
  error MixedTitles();
  error Insufficient();

  constructor(IRootFeed feed_, ITrieVerify verifier_) {
    feed = feed_;
    verifier = verifier_;
  }

  /// Revive maps an AccountId32 to the last 20 bytes of its keccak256.
  function mappedAddress(bytes32 account) public pure returns (address) {
    return address(uint160(uint256(keccak256(abi.encodePacked(account)))));
  }

  function titleId(uint32 collection, uint32 item) public pure returns (bytes32) {
    return keccak256(abi.encodePacked(collection, item));
  }

  /// Nfts::Item key: prefix ++ blake2_128(c) ++ c_le ++ blake2_128(i) ++ i_le.
  /// The blake2 parts are not recomputed: a key with a wrong hash is simply
  /// not in the trie, so it can never prove a value.
  function _parse(bytes calldata key) internal pure returns (uint32 collection, uint32 item) {
    if (key.length != 72 || bytes32(key[0:32]) != ITEM_PREFIX) revert BadKey();
    collection = _u32le(key[48:52]);
    item = _u32le(key[68:72]);
  }

  function _u32le(bytes calldata b) internal pure returns (uint32) {
    return uint32(uint8(b[0])) | (uint32(uint8(b[1])) << 8) | (uint32(uint8(b[2])) << 16) | (uint32(uint8(b[3])) << 24);
  }

  function _prove(bytes calldata key, bytes[] calldata nodes) internal view returns (uint8 status, bytes memory value) {
    (status, value) = verifier.verify(feed.currentRoot(), key, nodes);
  }

  /// Mint UNITS to the caller, who must be the mapped account of the item's native owner.
  function claim(bytes calldata key, bytes[] calldata nodes) external {
    (uint32 collection, uint32 item) = _parse(key);
    bytes32 id = titleId(collection, item);
    Title storage t = titles[id];
    if (t.claimed) revert AlreadyClaimed();

    (uint8 status, bytes memory value) = _prove(key, nodes);
    if (status != 1 || value.length < 32) revert NotProven(status);
    bytes32 owner;
    assembly {
      owner := mload(add(value, 32))
    }
    address expected = mappedAddress(owner);
    if (msg.sender != expected) revert NotTheNativeOwner(expected);

    uint256 rootBlock = feed.currentBlockNumber();
    t.owner = owner;
    t.claimed = true;
    t.claimedAt = rootBlock;
    _credit(msg.sender, id, UNITS);
    t.outstanding = UNITS;
    totalSupply += UNITS;
    emit Transfer(address(0), msg.sender, UNITS);
    emit Claimed(collection, item, owner, msg.sender, rootBlock);
  }

  /// Anyone: prove the item no longer exists, or belongs to someone else, at a
  /// root newer than the claim. The representation freezes.
  function freeze(bytes calldata key, bytes[] calldata nodes) external {
    (uint32 collection, uint32 item) = _parse(key);
    bytes32 id = titleId(collection, item);
    Title storage t = titles[id];
    if (!t.claimed) revert NotClaimed();
    if (t.frozen) revert TitleFrozen();

    (uint8 status, bytes memory value) = _prove(key, nodes);
    bool absent = status == 2; // ABSENT: the item was burned natively
    if (!absent) {
      if (status != 1 || value.length < 32) revert NotProven(status);
      bytes32 owner;
      assembly {
        owner := mload(add(value, 32))
      }
      if (owner == t.owner) revert StillHeld();
    }
    t.frozen = true;
    emit Frozen(collection, item, feed.currentBlockNumber(), absent);
  }

  function _credit(address to, bytes32 id, uint256 amount) internal {
    bytes32 held = titleOf[to];
    if (held != bytes32(0) && held != id && balanceOf[to] != 0) revert MixedTitles();
    titleOf[to] = id;
    balanceOf[to] += amount;
  }

  function _move(address from, address to, uint256 amount) internal {
    bytes32 id = titleOf[from];
    if (titles[id].frozen) revert TitleFrozen();
    if (balanceOf[from] < amount) revert Insufficient();
    balanceOf[from] -= amount;
    _credit(to, id, amount);
    emit Transfer(from, to, amount);
  }

  function transfer(address to, uint256 amount) external returns (bool) {
    _move(msg.sender, to, amount);
    return true;
  }

  function approve(address spender, uint256 amount) external returns (bool) {
    allowance[msg.sender][spender] = amount;
    emit Approval(msg.sender, spender, amount);
    return true;
  }

  function transferFrom(address from, address to, uint256 amount) external returns (bool) {
    uint256 allowed = allowance[from][msg.sender];
    if (allowed < amount) revert Insufficient();
    if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
    _move(from, to, amount);
    return true;
  }

  /// A holder can always retire their representation, frozen or not.
  function burn(uint256 amount) external {
    if (balanceOf[msg.sender] < amount) revert Insufficient();
    bytes32 id = titleOf[msg.sender];
    balanceOf[msg.sender] -= amount;
    titles[id].outstanding -= amount;
    totalSupply -= amount;
    emit Transfer(msg.sender, address(0), amount);
  }
}
