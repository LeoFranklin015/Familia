import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { mkdirSync } from 'node:fs'
import { joinRoutes } from './routes/join.js'
import { parentRoutes } from './routes/parent.js'
import { memberRoutes } from './routes/member.js'

mkdirSync(new URL('../data', import.meta.url).pathname, { recursive: true })

const app = new Hono()

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: err.message ?? 'unexpected error' }, 500)
})

app.route('/', joinRoutes)
app.route('/', parentRoutes)
app.route('/', memberRoutes)

// The built web app; /join/<token> etc. fall through to the SPA.
app.use('/assets/*', serveStatic({ root: '../web/dist' }))
app.get('*', serveStatic({ root: '../web/dist', path: 'index.html' }))

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port }, () => console.log(`kin server on :${port}`))
