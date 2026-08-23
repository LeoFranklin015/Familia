import { describe, expect, it } from 'vitest'
import { spendState } from './spendState'
import type { MemberState } from '../../api'

const SHOP = '0x1111000000000000000000000000000000001111'
const OTHER = '0x2222000000000000000000000000000000002222'

/** Maya: 5 a purchase, 25 a week, 11.40 already spent. */
const maya = (over: Partial<MemberState> = {}): MemberState => ({
  name: 'Maya', familyName: 'Vance', symbol: 'USDT',
  hasAllowance: true, revoked: false,
  limit: '5.000000', period: '25.000000',
  spentThisPeriod: '11.400000',
  headroom: '5.000000',
  resetsAt: 0,
  recipients: [
    { id: 'r1', name: 'Corner Store', address: SHOP, kind: 'SHOP' },
    { id: 'r2', name: 'Book Shop', address: OTHER, kind: 'SHOP' },
  ],
  allowOnly: false, allowed: [],
  myRequests: [], activity: [],
  ...over,
})

describe('within the limits', () => {
  it('pays', () => {
    const s = spendState(maya(), SHOP, '3')
    expect(s.over).toBe(false)
    expect(s.ready).toBe(true)
    expect(s.name).toBe('Corner Store')
    expect(s.hint).toBeUndefined()
  })
})

describe('over a limit, it asks rather than refuses', () => {
  it('asks when over the per-purchase cap', () => {
    const s = spendState(maya(), SHOP, '6')
    expect(s.over).toBe(true)
    expect(s.ready).toBe(true) // the button stays live
    expect(s.hint).toContain('goes home')
  })

  it('asks when over what the week has left', () => {
    // 20 is inside no single-purchase rule they could meet, and over the week.
    const s = spendState(maya({ headroom: '13.600000' }), SHOP, '20')
    expect(s.over).toBe(true)
    expect(s.ready).toBe(true)
  })
})

// `spend` checks the allowlist and reverts; `requestSpend` does not, and
// neither does the guardian's `approveRequest`. So an address off the list is
// a reason to ask, not a dead end.
describe('outside their places', () => {
  const restricted = maya({ allowOnly: true, allowed: [SHOP] })

  it('pays somewhere on the list', () => {
    const s = spendState(restricted, SHOP, '3')
    expect(s.offList).toBe(false)
    expect(s.over).toBe(false)
  })

  it('asks for somewhere off it, and never blocks', () => {
    const s = spendState(restricted, OTHER, '3')
    expect(s.offList).toBe(true)
    expect(s.over).toBe(true)
    expect(s.ready).toBe(true)
    expect(s.problem).toContain('yes from home')
  })

  it('ignores the list when they are not restricted', () => {
    expect(spendState(maya(), OTHER, '3').offList).toBe(false)
  })

  it('matches the list regardless of address casing', () => {
    const mixed = maya({ allowOnly: true, allowed: [SHOP.toUpperCase().replace('0X', '0x')] })
    expect(spendState(mixed, SHOP, '3').offList).toBe(false)
  })
})

// A guardian approving would not help: `approveRequest` still has to pull the
// funds. So this one is genuinely blocked, and says a different thing.
describe('when the household cannot cover it', () => {
  it('blocks rather than asking', () => {
    const s = spendState(maya({ headroom: '1.000000' }), SHOP, '3')
    expect(s.shortAtHome).toBe(true)
    expect(s.over).toBe(false)
    expect(s.ready).toBe(false)
    expect(s.hint).toContain("isn't enough at home")
  })
})

describe('the address itself', () => {
  it('is the only thing that stops the button', () => {
    expect(spendState(maya(), '0x123', '3').ready).toBe(false)
    expect(spendState(maya(), '0x123', '3').problem).toContain("doesn't look like an address")
    expect(spendState(maya(), '', '3').problem).toBeUndefined()
  })

  it('needs an amount too', () => {
    expect(spendState(maya(), SHOP, '').ready).toBe(false)
    expect(spendState(maya(), SHOP, '0').ready).toBe(false)
  })
})

// The regression that made typing the displayed figure read as over-limit.
describe('typing exactly what the screen says is left', () => {
  it('is not treated as over the limit', () => {
    // period 1, spent 0.07 -> 0.9299999999999999 as a float, shown as 0.93
    const m = maya({ limit: '5.000000', period: '1.000000', spentThisPeriod: '0.070000', headroom: '0.930000' })
    const s = spendState(m, SHOP, '0.93')
    expect(s.over).toBe(false)
    expect(s.shortAtHome).toBe(false)
    expect(s.ready).toBe(true)
  })
})
