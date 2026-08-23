// The chain, in one import.
//
// Split by what each part is for; this file is the seam, so route code keeps a
// single import rather than five — and names its surface explicitly, so the
// split did not quietly make every internal helper public.
//
//   config   addresses, endpoints, the provider, unit conversion
//   abis     interfaces and read-only contracts, built once
//   fees     what an operation costs and who can cover it
//   batches  the calldata each action sends
//   decode   reading storage, receipts and reverts back
export type { Tx } from './chain/abis.js'
export {
  AAVE,
  BUNDLER_URL,
  CHAIN_ID,
  DELEGATION_ADDRESS,
  MANAGER,
  PAYMASTER_SERVICE_URL,
  POLICY_ID,
  RPC_URL,
  USDT_PAYMASTER,
  formatUnits,
  parseUnits,
} from './chain/config.js'
export {
  aAssetRead,
  erc20,
  managerIface,
  managerRead,
  paymasterRead,
} from './chain/abis.js'
export {
  canPayFeesInUsdt,
  depositableAmount,
  feeChargedFromLogs,
} from './chain/fees.js'
export {
  buildAllowlistBatch,
  buildGrantBatch,
  buildOnboardingBatch,
  buildRevokeBatch,
  planDeposit,
  planGuardianPay,
  predictScopeId,
} from './chain/batches.js'
export {
  eventArgFromLogs,
  humanizeManagerRevert,
  spentInCurrentPeriod,
  supplyApr,
} from './chain/decode.js'
