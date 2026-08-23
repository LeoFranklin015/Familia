import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type Context, type Next } from 'hono'
import { mkdirSync } from 'node:fs'
import { joinRoutes } from './routes/join.js'
import { parentRoutes } from './routes/parent.js'
import { memberRoutes } from './routes/member.js'
import { paymasterService } from './paymaster-service.js'
import { Contended, openStore } from './store.js'
import { AuthError } from './authorize.js'

mkdirSync(new URL('../data', import.meta.url).pathname, { recursive: true })

const app = new Hono()

/**
 * One place where a thrown thing becomes a response.
 *
 * Routes used to catch `AuthError` individually and translate it, which meant
 * remembering to. The two errors that carry words meant for a person are
 * translated here; anything else is a bug and says so.
 */
app.onError((err, c) => {
  if (err instanceof AuthError) {
    return c.json({
      error: err.message,
      needsAuth: err.status === 401,
      sessionEnded: err.status === 401,
    }, err.status)
  }
  if (err instanceof Contended) return c.json({ error: err.message }, 409)
  console.error(err)
  return c.json({ error: err.message ?? 'unexpected error' }, 500)
})

/**
 * Log every API answer that isn't a success, with the reason we gave.
 *
 * Handled refusals return `c.json({ error }, 4xx)` and never reach onError, so
 * a run of failed writes left no trace at all in the log — the one thing you
 * need when someone says it always fails.
 */
app.use('/api/*', async (c, next) => {
  const started = Date.now()
  await next()
  if (c.res.status >= 400) {
    let why = ''
    try { why = ((await c.res.clone().json()) as { error?: string }).error ?? '' } catch { /* not json */ }
    console.warn(`${c.res.status} ${c.req.method} ${c.req.path} (${Date.now() - started}ms) ${why}`)
  }
})

app.route('/', joinRoutes)
app.route('/', parentRoutes)
app.route('/', memberRoutes)
// Our ERC-7677 paymaster service, so USD₮ can be the gas token here.
app.route('/', paymasterService)

/**
 * The built web app; /join/<token> etc. fall through to the SPA. Fonts need
 * their own route — without it they hit the catch-all and get index.html.
 *
 * Caching is split along the line the build already draws for us. Asset
 * filenames carry a content hash, so they can be cached forever and a new
 * build simply asks for different names. `index.html` is the one file whose
 * name never changes, and it is the file that names the others — so it must
 * never be cached. Without this it was served with no cache headers at all,
 * which means heuristic caching: browsers and the tunnel both held on to a
 * shell pointing at bundles that no longer existed, and a redeploy quietly
 * failed to reach anyone who had already visited.
 */
const immutable = (c: Context, next: Next) => {
  c.header('Cache-Control', 'public, max-age=31536000, immutable')
  return next()
}
app.use('/assets/*', immutable, serveStatic({ root: '../web/dist' }))
app.use('/fonts/*', immutable, serveStatic({ root: '../web/dist' }))
// The icon sits at the root rather than under /assets, so without its own
// route it fell through to the SPA handler below and every request for it
// returned the HTML shell.
app.use('/icon.png', serveStatic({ root: '../web/dist', path: 'icon.png' }))
app.get(
  '*',
  (c, next) => {
    c.header('Cache-Control', 'no-store, must-revalidate')
    return next()
  },
  serveStatic({ root: '../web/dist', path: 'index.html' }),
)

const port = Number(process.env.PORT ?? 8787)

// Open storage before listening. A bad connection string should stop the
// server here, not surface halfway through someone's first payment.
const where = await openStore()
serve({ fetch: app.fetch, port }, () => console.log(`familia server on :${port}  ·  storage: ${where}`))
