// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Minimal surfaces — no imports from any wallet SDK by design.
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

/// Aave V3 pool: withdraw burns msg.sender's aTokens and pays `to` directly.
interface IPool {
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

/**
 * @title ScopedSpendManager
 * @notice A funder authorises spenders to move the funder's tokens within
 *         onchain limits: a per-transaction cap, a rolling per-period cap, an
 *         optional recipient allowlist, and an optional expiry.
 *
 *         Each scope names two tokens:
 *           - `asset`:  what the recipient receives
 *           - `source`: what is pulled from the funder
 *         When `source == asset` the spend is a plain ERC-20 pull, funder → recipient.
 *         When they differ, `source` is treated as a yield receipt (e.g. an
 *         Aave aToken): the manager pulls `source` from the funder for the
 *         duration of one call and redeems it through the pool set at
 *         construction, paying the recipient directly. The manager never
 *         custodies funds across calls.
 *
 *         This contract is deliberately generic: household allowances, team
 *         budgets, agent spend caps and subscription mandates are the same
 *         object. Vocabulary is funder/spender only.
 */
contract ScopedSpendManager {
    // ---------------------------------------------------------------- errors
    error UnknownId();
    error NotSpender();
    error NotFunder();
    error Revoked();
    error Expired();
    error OverPerTxCap(uint256 amount, uint256 cap);
    error OverPeriodCap(uint256 wouldBe, uint256 cap);
    error RecipientNotAllowed(address to);
    error RequestExpired();
    error RequestNotPending();
    error PoolNotSet();
    error TransferFailed();
    error InvalidScope();

    // ---------------------------------------------------------------- events
    event Granted(
        bytes32 indexed id,
        address indexed funder,
        address indexed spender,
        address asset,
        address source,
        uint256 perTxCap,
        uint256 periodCap,
        uint256 periodLength,
        uint256 expiry
    );
    event ScopeUpdated(bytes32 indexed id, uint256 perTxCap, uint256 periodCap, uint256 periodLength, uint256 expiry);
    event AllowlistSet(bytes32 indexed id, address indexed target, bool allowed);
    event ScopeRevoked(bytes32 indexed id);
    event Spent(bytes32 indexed id, address indexed to, uint256 amount, bytes32 requestId);
    event SpendRequested(bytes32 indexed requestId, bytes32 indexed id, address indexed to, uint256 amount, uint256 expiresAt);
    event RequestDenied(bytes32 indexed requestId);

    // --------------------------------------------------------------- storage
    struct Scope {
        address funder;
        address spender;
        address asset;
        address source;
        uint128 perTxCap;
        uint128 periodCap;
        uint48 periodLength; // seconds; periods align to grantedAt
        uint48 grantedAt;
        uint48 expiry; // 0 = never expires
        bool revoked;
        uint128 spentInPeriod;
        uint48 periodStart; // start of the period `spentInPeriod` belongs to
        uint32 allowlistSize; // 0 = any recipient
    }

    enum RequestStatus {
        None,
        Pending,
        Settled,
        Denied
    }

    struct Request {
        bytes32 scopeId;
        address to;
        uint128 amount;
        uint48 expiresAt;
        RequestStatus status;
    }

    IPool public immutable pool; // address(0) disables the redemption path

    mapping(bytes32 => Scope) internal _scopes;
    mapping(bytes32 => mapping(address => bool)) public allowlist;
    mapping(bytes32 => Request) internal _requests;
    uint256 internal _nonce;
    uint256 private _lock = 1;

    modifier nonReentrant() {
        require(_lock == 1, "reentrancy");
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(IPool pool_) {
        pool = pool_;
    }

    // ---------------------------------------------------------------- funder
    function grant(
        address spender,
        address asset,
        address source,
        uint256 perTxCap,
        uint256 periodCap,
        uint256 periodLength,
        uint256 expiry
    ) external returns (bytes32 id) {
        if (spender == address(0) || asset == address(0) || source == address(0)) revert InvalidScope();
        if (periodLength == 0 || periodLength > type(uint48).max) revert InvalidScope();
        if (expiry != 0 && expiry <= block.timestamp) revert InvalidScope();
        if (source != asset && address(pool) == address(0)) revert PoolNotSet();

        id = keccak256(abi.encodePacked(msg.sender, spender, asset, source, _nonce++));
        Scope storage s = _scopes[id];
        s.funder = msg.sender;
        s.spender = spender;
        s.asset = asset;
        s.source = source;
        s.perTxCap = _toU128(perTxCap);
        s.periodCap = _toU128(periodCap);
        s.periodLength = uint48(periodLength);
        s.grantedAt = uint48(block.timestamp);
        s.expiry = uint48(expiry);
        s.periodStart = uint48(block.timestamp);

        emit Granted(id, msg.sender, spender, asset, source, perTxCap, periodCap, periodLength, expiry);
    }

    function updateScope(bytes32 id, uint256 perTxCap, uint256 periodCap, uint256 periodLength, uint256 expiry)
        external
    {
        Scope storage s = _funderScope(id);
        if (periodLength == 0 || periodLength > type(uint48).max) revert InvalidScope();
        if (expiry != 0 && expiry <= block.timestamp) revert InvalidScope();
        _rollPeriod(s); // settle the old window before the rules change
        s.perTxCap = _toU128(perTxCap);
        s.periodCap = _toU128(periodCap);
        s.periodLength = uint48(periodLength);
        s.expiry = uint48(expiry);
        emit ScopeUpdated(id, perTxCap, periodCap, periodLength, expiry);
    }

    function setAllowlist(bytes32 id, address[] calldata targets, bool allowed) external {
        Scope storage s = _funderScope(id);
        for (uint256 i = 0; i < targets.length; i++) {
            if (allowlist[id][targets[i]] != allowed) {
                allowlist[id][targets[i]] = allowed;
                allowed ? s.allowlistSize++ : s.allowlistSize--;
            }
            emit AllowlistSet(id, targets[i], allowed);
        }
    }

    function revoke(bytes32 id) external {
        Scope storage s = _funderScope(id);
        s.revoked = true;
        emit ScopeRevoked(id);
    }

    // --------------------------------------------------------------- spender
    function spend(bytes32 id, address to, uint256 amount) external nonReentrant {
        Scope storage s = _scopes[id];
        if (s.funder == address(0)) revert UnknownId();
        if (msg.sender != s.spender) revert NotSpender();
        _checkLive(s);
        if (s.allowlistSize != 0 && !allowlist[id][to]) revert RecipientNotAllowed(to);
        if (amount > s.perTxCap) revert OverPerTxCap(amount, s.perTxCap);

        _rollPeriod(s);
        uint256 wouldBe = uint256(s.spentInPeriod) + amount;
        if (wouldBe > s.periodCap) revert OverPeriodCap(wouldBe, s.periodCap);
        s.spentInPeriod = uint128(wouldBe);

        _settle(s, to, amount);
        emit Spent(id, to, amount, bytes32(0));
    }

    function requestSpend(bytes32 id, address to, uint256 amount, uint256 ttl) external returns (bytes32 requestId) {
        Scope storage s = _scopes[id];
        if (s.funder == address(0)) revert UnknownId();
        if (msg.sender != s.spender) revert NotSpender();
        _checkLive(s);

        requestId = keccak256(abi.encodePacked(id, to, amount, _nonce++));
        _requests[requestId] = Request({
            scopeId: id,
            to: to,
            amount: _toU128(amount),
            expiresAt: uint48(block.timestamp + ttl),
            status: RequestStatus.Pending
        });
        emit SpendRequested(requestId, id, to, amount, block.timestamp + ttl);
    }

    // ---------------------------------------------------------- funder again
    /// @notice Settles a pending request, ignoring the per-tx and period caps.
    /// This is deliberate: an explicit per-request authorisation from the
    /// asset owner outranks the standing scope — the caps exist to bound what
    /// the spender can do alone. Revocation and expiry still apply, because
    /// they kill the relationship itself, not just its limits.
    function approveRequest(bytes32 requestId) external nonReentrant {
        Request storage r = _requests[requestId];
        if (r.status != RequestStatus.Pending) revert RequestNotPending();
        Scope storage s = _scopes[r.scopeId];
        if (msg.sender != s.funder) revert NotFunder();
        if (block.timestamp > r.expiresAt) revert RequestExpired();
        _checkLive(s);

        r.status = RequestStatus.Settled;
        _settle(s, r.to, r.amount);
        emit Spent(r.scopeId, r.to, r.amount, requestId);
    }

    function denyRequest(bytes32 requestId) external {
        Request storage r = _requests[requestId];
        if (r.status != RequestStatus.Pending) revert RequestNotPending();
        if (msg.sender != _scopes[r.scopeId].funder) revert NotFunder();
        r.status = RequestStatus.Denied;
        emit RequestDenied(requestId);
    }

    // ----------------------------------------------------------------- views
    /// @notice The single number that drives a spender's UI. Nets the per-tx
    /// cap against the remaining period allowance and the funder's real
    /// source-token balance and allowance, so the spender never sees an
    /// amount that would revert.
    function spendable(bytes32 id) external view returns (uint256) {
        Scope storage s = _scopes[id];
        if (s.funder == address(0) || s.revoked) return 0;
        if (s.expiry != 0 && block.timestamp > s.expiry) return 0;

        uint256 remaining = s.periodCap;
        if (_currentPeriodStart(s) == s.periodStart) {
            remaining = s.periodCap >= s.spentInPeriod ? s.periodCap - s.spentInPeriod : 0;
        }
        uint256 cap = remaining < s.perTxCap ? remaining : s.perTxCap;

        uint256 funderBalance = IERC20(s.source).balanceOf(s.funder);
        uint256 funderAllowance = IERC20(s.source).allowance(s.funder, address(this));
        uint256 available = funderBalance < funderAllowance ? funderBalance : funderAllowance;
        return cap < available ? cap : available;
    }

    function periodResetsAt(bytes32 id) external view returns (uint64) {
        Scope storage s = _scopes[id];
        if (s.funder == address(0)) revert UnknownId();
        return uint64(_currentPeriodStart(s) + s.periodLength);
    }

    function getScope(bytes32 id) external view returns (Scope memory) {
        return _scopes[id];
    }

    function getRequest(bytes32 requestId) external view returns (Request memory) {
        return _requests[requestId];
    }

    // ------------------------------------------------------------- internals
    function _funderScope(bytes32 id) internal view returns (Scope storage s) {
        s = _scopes[id];
        if (s.funder == address(0)) revert UnknownId();
        if (msg.sender != s.funder) revert NotFunder();
    }

    function _checkLive(Scope storage s) internal view {
        if (s.revoked) revert Revoked();
        if (s.expiry != 0 && block.timestamp > s.expiry) revert Expired();
    }

    function _currentPeriodStart(Scope storage s) internal view returns (uint256) {
        uint256 elapsed = block.timestamp - s.grantedAt;
        return s.grantedAt + (elapsed / s.periodLength) * s.periodLength;
    }

    function _rollPeriod(Scope storage s) internal {
        uint48 current = uint48(_currentPeriodStart(s));
        if (current != s.periodStart) {
            s.periodStart = current;
            s.spentInPeriod = 0;
        }
    }

    /// One branch: same-token scopes settle as a direct funder → recipient
    /// pull; yield-receipt scopes pull the source into the manager and redeem
    /// through the pool, which pays the recipient in the same transaction.
    /// The direct path is also the fallback if the lending leg breaks.
    function _settle(Scope storage s, address to, uint256 amount) internal {
        if (s.source == s.asset) {
            _pull(s.source, s.funder, to, amount);
        } else {
            _pull(s.source, s.funder, address(this), amount);
            pool.withdraw(s.asset, amount, to);
        }
    }

    /// Tolerates tokens that don't return a bool from transferFrom (e.g. USDT).
    function _pull(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _toU128(uint256 v) internal pure returns (uint128) {
        if (v > type(uint128).max) revert InvalidScope();
        return uint128(v);
    }
}
