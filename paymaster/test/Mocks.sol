// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Standard-ish ERC20; `returnsBool = false` mimics mainnet USDT's
/// no-return transferFrom so _pull's tolerance is actually exercised.
contract MockERC20 {
    string public name;
    uint8 public immutable decimals;
    bool public immutable returnsBool;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, uint8 decimals_, bool returnsBool_) {
        name = name_;
        decimals = decimals_;
        returnsBool = returnsBool_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        if (!returnsBool) {
            assembly {
                return(0, 0) // no return data, like USDT
            }
        }
        return true;
    }

    /// Test-only stand-in for Aave's internal burn (no allowance needed).
    function burnFor(address from, uint256 amount) external {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

/// Minimal Aave-shaped pool: withdraw burns msg.sender's aTokens 1:1 and pays
/// `to` in the underlying from the pool's own reserves.
