// A minimal ERC-7677 paymaster service in front of our own UsdtPaymaster.
//
// WDK's gasless module doesn't talk to a paymaster contract directly; it talks
// to a paymaster *service* (abstractionkit's Erc7677Paymaster) over JSON-RPC.
// Point `paymasterUrl` at this and USD₮ becomes the gas token on a chain where
// no provider offers one.
//
// It is deliberately trivial — and stateless, and keyless. Because
// UsdtPaymaster is permissionless (authorisation is the USD₮ approval itself,
// not a signed voucher), this service has no signing to do and no secret to
// hold. Its whole job is to name the paymaster and quote gas limits. Every
// rule that matters is enforced on-chain.
import { Hono } from 'hono'
import { AAVE, CHAIN_ID, USDT_PAYMASTER, paymasterRead } from './chain.js'

const ENTRY_POINT_V8 = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'

/** Gas the EntryPoint should budget for our postOp: one ERC-20 transferFrom
 *  plus event, with head-room. Under-quoting here makes the bundler drop the
 *  operation at settlement time, so it is deliberately generous. */
const POSTOP_GAS = 120_000n

const hex = (v: bigint) => '0x' + v.toString(16)

export const paymasterService = new Hono()

paymasterService.post('/paymaster', async (c) => {
  const body = await c.req.json().catch(() => null)
  const reply = (result: unknown) => c.json({ jsonrpc: '2.0', id: body?.id ?? null, result })
  const fail = (code: number, message: string) =>
    c.json({ jsonrpc: '2.0', id: body?.id ?? null, error: { code, message } })

  if (!USDT_PAYMASTER) return fail(-32000, 'USDT_PAYMASTER_ADDRESS is not configured')

  switch (body?.method) {
    case 'pm_chainId':
      return reply(hex(BigInt(CHAIN_ID)))

    case 'pm_supportedEntryPoints':
      return reply([ENTRY_POINT_V8])

    // Candide-shaped discovery, which is how WDK asks what a non-Pimlico
    // paymaster will accept and at what rate.
    case 'pm_supportedERC20Tokens': {
      const rate = (await paymasterRead!
        .usdtPerNativeUnit()) as bigint
      return reply({
        tokens: [{
          address: AAVE.ASSET,
          symbol: AAVE.SYMBOL,
          decimals: AAVE.DECIMALS,
          exchangeRate: rate.toString(),
        }],
      })
    }

    // Stub data is used for gas estimation, final data for the real send.
    // Our paymaster needs no calldata in either case, so the two differ only
    // in `isFinal`.
    //
    // `isFinal` must stay false on the stub. The client's order is
    // stub → estimate → getPaymasterData, and the estimate step overwrites
    // paymasterPostOpGasLimit with whatever the bundler guessed — for us,
    // 3,775, far below the ~25k a transferFrom needs, which makes postOp run
    // out of gas and the whole operation revert. Only the final call re-applies
    // our number, and a stub marked final short-circuits before it happens.
    case 'pm_getPaymasterStubData':
    case 'pm_getPaymasterData': {
      const [, entryPoint] = body.params ?? []
      if (entryPoint && String(entryPoint).toLowerCase() !== ENTRY_POINT_V8.toLowerCase()) {
        return fail(-32602, `unsupported EntryPoint ${entryPoint}`)
      }
      return reply({
        paymaster: USDT_PAYMASTER,
        paymasterData: '0x',
        paymasterVerificationGasLimit: hex(80_000n),
        paymasterPostOpGasLimit: hex(POSTOP_GAS),
        sponsor: { name: 'Familia USD₮ paymaster' },
        isFinal: body.method === 'pm_getPaymasterData',
      })
    }

    default:
      return fail(-32601, `method ${body?.method ?? '(none)'} not supported`)
  }
})

