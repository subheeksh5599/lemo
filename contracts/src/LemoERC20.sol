// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITitleRegistry {
    function isEligible(bytes32 titleId) external view returns (bool);
}

/// @title LemoERC20
/// @notice The market face of one LEMO title. Supply can never exceed the backing recorded at
///         deployment, and no transfer moves while the title is ineligible in the registry —
///         the two rules of the protocol expressed on the EVM side.
contract LemoERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    bytes32 public immutable titleId;
    uint256 public immutable backingCap;
    ITitleRegistry public immutable registry;
    address public immutable minter;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    error NotMinter();
    error CapExceeded(uint256 cap, uint256 requested);
    error TitleIneligible();
    error InsufficientBalance(address from, uint256 balance, uint256 amount);
    error InsufficientAllowance(address spender, uint256 allowed, uint256 amount);
    error ZeroAddress();

    constructor(string memory name_, string memory symbol_, bytes32 titleId_, uint256 backingCap_, ITitleRegistry registry_) {
        if (address(registry_) == address(0)) revert ZeroAddress();
        name = name_;
        symbol = symbol_;
        titleId = titleId_;
        backingCap = backingCap_;
        registry = registry_;
        minter = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        if (totalSupply + amount > backingCap) revert CapExceeded(backingCap, totalSupply + amount);
        if (to == address(0)) revert ZeroAddress();

        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function burn(uint256 amount) external {
        uint256 balance = balanceOf[msg.sender];
        if (balance < amount) revert InsufficientBalance(msg.sender, balance, amount);

        unchecked {
            balanceOf[msg.sender] = balance - amount;
        }
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance(msg.sender, allowed, amount);
            unchecked {
                allowance[from][msg.sender] = allowed - amount;
            }
        }
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) private {
        if (to == address(0)) revert ZeroAddress();
        if (!registry.isEligible(titleId)) revert TitleIneligible();

        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance(from, balance, amount);

        unchecked {
            balanceOf[from] = balance - amount;
        }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
