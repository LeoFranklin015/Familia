// Every interface and read-only contract, built once at module load.
//
// Constructing one per call re-parses an ABI on a hot path, which is what the
// fee lookup used to do on every request.
import { ethers } from 'ethers'
import { AaveV3BaseSepolia } from '@bgd-labs/aave-address-book'
import { AAVE, MANAGER, provider, USDT_PAYMASTER } from './config.js'

/** One call inside a batched UserOperation. */
export type Tx = { to: string; value: bigint; data: string }

export const erc20 = new ethers.Interface([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
])
export const faucetIface = new ethers.Interface([
  'function mint(address token, address to, uint256 amount) returns (uint256)',
])
/** Aave's own view of the reserve. Only the supply rate is wanted. */
export const poolRead = new ethers.Contract(AaveV3BaseSepolia.POOL, [
  'function getReserveData(address) view returns (tuple(uint256 configuration,uint128 liquidityIndex,uint128 currentLiquidityRate,uint128 variableBorrowIndex,uint128 currentVariableBorrowRate,uint128 currentStableBorrowRate,uint40 lastUpdateTimestamp,uint16 id,address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress,address interestRateStrategyAddress,uint128 accruedToTreasury,uint128 unbacked,uint128 isolationModeTotalDebt))',
], provider)

export const poolIface = new ethers.Interface([
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
])
export const managerIface = new ethers.Interface([
  'function grant(address spender, address asset, address source, uint256 perTxCap, uint256 periodCap, uint256 periodLength, uint256 expiry) returns (bytes32)',
  'function updateScope(bytes32 id, uint256 perTxCap, uint256 periodCap, uint256 periodLength, uint256 expiry)',
  'function setAllowlist(bytes32 id, address[] targets, bool allowed)',
  'function revoke(bytes32 id)',
  'function spend(bytes32 id, address to, uint256 amount)',
  'function requestSpend(bytes32 id, address to, uint256 amount, uint256 ttl) returns (bytes32)',
  'function approveRequest(bytes32 requestId)',
  'function denyRequest(bytes32 requestId)',
  'function spendable(bytes32 id) view returns (uint256)',
  'function periodResetsAt(bytes32 id) view returns (uint64)',
  'function getScope(bytes32 id) view returns (tuple(address funder, address spender, address asset, address source, uint128 perTxCap, uint128 periodCap, uint48 periodLength, uint48 grantedAt, uint48 expiry, bool revoked, uint128 spentInPeriod, uint48 periodStart, uint32 allowlistSize))',
  'event Granted(bytes32 indexed id, address indexed funder, address indexed spender, address asset, address source, uint256 perTxCap, uint256 periodCap, uint256 periodLength, uint256 expiry)',
  'event SpendRequested(bytes32 indexed requestId, bytes32 indexed id, address indexed to, uint256 amount, uint256 expiresAt)',
  'event Spent(bytes32 indexed id, address indexed to, uint256 amount, bytes32 requestId)',
])

/** Our paymaster's settlement event — the authoritative record of what an
 *  account was actually charged, in USD₮, after the operation ran. */
export const paymasterIface = new ethers.Interface([
  'event Charged(address indexed account, uint256 gasCostWei, uint256 usdtCharged)',
  'function quote(uint256 gasCostWei) view returns (uint256)',
  'function usdtPerNativeUnit() view returns (uint256)',
])

export const managerRead = new ethers.Contract(MANAGER, managerIface, provider)
/** Built once. It used to be constructed inside `feePerOperation`, so every
 *  fee lookup re-parsed an ABI. */
export const paymasterRead = USDT_PAYMASTER
  ? new ethers.Contract(USDT_PAYMASTER, paymasterIface, provider)
  : null
export const assetRead = new ethers.Contract(AAVE.ASSET, erc20, provider)
export const aAssetRead = new ethers.Contract(AAVE.A_ASSET, erc20, provider)
