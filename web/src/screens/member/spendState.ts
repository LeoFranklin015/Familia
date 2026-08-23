import type { MemberState } from '../../api'
import { base } from '../../lib/money'
import { isAllowed, labelFor, looksLikeAddress } from '../../lib/address'
import { two } from '../../lib/money'

/**
 * Whether this payment can happen, and what to call the button if not.
 *
 * Pure, so it can be reasoned about and tested without a screen around it —
 * this is the most interesting logic in the app and it used to live as thirty
 * lines of derivation inside a component.
 *
 * Every comparison is in whole base units, the way the contract does it. As
 * floats, `period - spent` lands a hair under the figure displayed for it
 * about a sixth of the time, so typing exactly the number on screen read as
 * being *over* the limit.
 */
export type SpendState = {
  /** Base units of the amount typed. */
  value: number
  /** What the week has left, which is the number a person thinks in. */
  weekLeft: number
  /** Resolved name for the address, or the address shortened. */
  name: string
  valid: boolean
  /** This will become a request rather than a payment. */
  over: boolean
  /** Nothing can be done with it: the household cannot cover it, and a
   *  guardian approving would not change that. */
  shortAtHome: boolean
  offList: boolean
  /** The button may be pressed. */
  ready: boolean
  /** Why the address needs saying something about. */
  problem?: string
  /** One line under the figure: what will happen, or why it will not. */
  hint?: string
}

export function spendState(me: MemberState, to: string, amount: string): SpendState {
  const value = base(amount || '0')
  const address = to.trim()
  const valid = looksLikeAddress(address)
  const name = labelFor(me.recipients, address)

  // `headroom` is what the contract would clear right now: the minimum of the
  // week remaining, the per-purchase cap, and what the household can cover.
  // The card shows the week and the button obeys the headroom, so when they
  // disagree the hint says which constraint is biting.
  const weekLeft = Math.max(0, base(me.period) - base(me.spentThisPeriod))
  const headroom = base(me.headroom)
  const perTx = base(me.limit)

  const overPerTx = perTx > 0 && value > perTx
  const overWeek = value > weekLeft
  // Within their own limits, but the household position cannot cover it. A
  // guardian approving would not help, because `approveRequest` still has to
  // pull the funds — so this is not an "ask" case.
  const shortAtHome = !overPerTx && !overWeek && value > headroom
  // Their own list, not the household's: having a name for an address and
  // being allowed to pay it are different questions.
  const offList = valid && me.allowOnly && !isAllowed(me.allowed, address)

  // Anything the contract will not let them do alone becomes a request rather
  // than a refusal. The chain agrees: `requestSpend` does not check the
  // allowlist, and neither does the guardian's `approveRequest`.
  const over = value > 0 && (overPerTx || overWeek || offList)

  return {
    value,
    weekLeft,
    name,
    valid,
    over,
    shortAtHome,
    offList,
    ready: valid && value > 0 && !shortAtHome,
    problem: !address ? undefined
      : !valid ? "That doesn't look like an address yet."
      : offList ? 'Not one of your places, so this one needs a yes from home.'
      : undefined,
    hint: offList ? 'Outside your places, so this goes home to say yes to.'
      : overPerTx ? `Over your ${two(me.limit)} limit, so this goes home to say yes to.`
      : overWeek && value > 0 ? 'More than you have left this week. A parent can wave it through.'
      : shortAtHome ? "There isn't enough at home to cover this right now."
      : undefined,
  }
}
