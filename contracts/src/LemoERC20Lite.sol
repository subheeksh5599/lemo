// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEligibility {
    function eligible(bytes32 titleId) external view returns (bool);
}

/// @title LemoERC20Lite
/// @notice ERC-20 representation of one LEMO title, sized for Portaldot's per-byte deposit.
///         Supply is capped by the backing recorded here, and no transfer moves while the native
///         title is ineligible in the registry — the market face of Rule 1 and Rule 2.
contract LemoERC20Lite {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    bytes32 public immutable titleId;
    uint256 public immutable cap;
    IEligibility public immutable registry;
    address public immutable issuer;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    error NotIssuer();
    error CapReached();
    error Ineligible();
    error NoBalance();
    error NoAllowance();
    error NoRecipient();

    constructor(string memory symbol_, bytes32 titleId_, uint256 cap_, IEligibility registry_) {
        symbol = symbol_;
        name = symbol_;
        titleId = titleId_;
        cap = cap_;
        registry = registry_;
        issuer = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != issuer) revert NotIssuer();
        if (to == address(0)) revert NoRecipient();
        if (totalSupply + amount > cap) revert CapReached();

        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function burn(uint256 amount) external {
        uint256 balance = balanceOf[msg.sender];
        if (balance < amount) revert NoBalance();

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
        move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert NoAllowance();
            unchecked {
                allowance[from][msg.sender] = allowed - amount;
            }
        }
        move(from, to, amount);
        return true;
    }

    function move(address from, address to, uint256 amount) private {
        if (to == address(0)) revert NoRecipient();
        if (!registry.eligible(titleId)) revert Ineligible();

        uint256 balance = balanceOf[from];
        if (balance < amount) revert NoBalance();

        unchecked {
            balanceOf[from] = balance - amount;
        }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
