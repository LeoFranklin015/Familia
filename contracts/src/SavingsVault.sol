// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title SavingsVault
 * @notice A minimal savings position for one ERC-20, deliberately shaped like
 *         an Aave V3 pool + aToken pair so that `ScopedSpendManager` cannot
 *         tell the difference:
 *
 *           - the vault is itself the receipt token (`source` in a scope)
 *           - `withdraw(asset, amount, to)` has Aave's exact signature, so the
 *             recipient is paid directly, in the same transaction
 *
 *         That is the whole point: on mainnet you point the manager at Aave's
 *         POOL with aUSDT as `source` and delete this file. On Sepolia the
 *         Aave USD₮ reserve sits ~2x over its supply cap, so `supply()` reverts
 *         for any amount and the same interface is served from here instead.
 *
 *         Shares are 1:1 with the underlying and do not rebase. There is no
 *         yield on testnet and none is claimed anywhere in the UI.
 */
contract SavingsVault {
    error WrongAsset();
    error InsufficientShares();
    error TransferFailed();

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, address indexed to, uint256 amount);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    string public constant name = "Kin Savings Position";
    string public constant symbol = "kUSDT";

    IERC20Min public immutable asset;
    uint8 public immutable decimals;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    constructor(IERC20Min asset_, uint8 decimals_) {
        asset = asset_;
        decimals = decimals_;
    }

    /// Pull `amount` of the underlying and credit the caller 1:1.
    function deposit(uint256 amount) external {
        _pull(address(asset), msg.sender, address(this), amount);
        balanceOf[msg.sender] += amount;
        totalSupply += amount;
        emit Deposited(msg.sender, amount);
        emit Transfer(address(0), msg.sender, amount);
    }

    /// Aave's signature exactly: burn the caller's shares and pay `to` in the
    /// underlying. `asset_` is validated so a mis-wired scope fails loudly.
    function withdraw(address asset_, uint256 amount, address to) external returns (uint256) {
        if (asset_ != address(asset)) revert WrongAsset();
        uint256 shares = balanceOf[msg.sender];
        if (shares < amount) revert InsufficientShares();

        unchecked {
            balanceOf[msg.sender] = shares - amount;
            totalSupply -= amount;
        }
        if (!asset.transfer(to, amount)) revert TransferFailed();

        emit Transfer(msg.sender, address(0), amount);
        emit Withdrawn(msg.sender, to, amount);
        return amount;
    }

    // --- the ERC-20 surface the manager needs to pull `source` from a funder ---

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
        if (allowed < amount) revert InsufficientShares();
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientShares();
        unchecked {
            balanceOf[from] = bal - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    /// Tolerates tokens that don't return a bool (USDT is the reason).
    function _pull(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20Min.transferFrom.selector, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
