// The guardian's surface, assembled.
//
// Split by what each group of routes is for rather than by HTTP verb, and all
// of them share one guard (`routes/guard.ts`) and one set of transaction
// plans (`routes/parent/plans.ts`) — the plans being the thing that keeps a
// quote and the transaction it prices from drifting apart.
import { Hono } from 'hono'
import { limitRoutes } from './parent/limits.js'
import { moneyRoutes } from './parent/money.js'
import { quoteRoutes } from './parent/quote.js'
import { recipientRoutes } from './parent/recipients.js'
import { stateRoutes } from './parent/state.js'
import { subscriptionRoutes } from './parent/subscriptions.js'

export const parentRoutes = new Hono()

parentRoutes.route('/', moneyRoutes)
parentRoutes.route('/', limitRoutes)
parentRoutes.route('/', recipientRoutes)
parentRoutes.route('/', subscriptionRoutes)
parentRoutes.route('/', quoteRoutes)
parentRoutes.route('/', stateRoutes)
