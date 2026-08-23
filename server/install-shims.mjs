// Replace Bare-runtime-only modules with Node-compatible shims after install.
// wdk-secret-manager requires `bare-crypto`, whose native binding only loads
// inside the Bare runtime; the one API used (pbkdf2Sync) exists in node:crypto
// with the same signature. Run from any directory: fixes every node_modules
// tree in this repo that contains (or needs) bare-crypto.
import { cpSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url)) + '/..'
const shim = join(root, 'server/shims/bare-crypto')

for (const tree of [join(root, 'node_modules'), join(root, 'server/node_modules')]) {
  if (!existsSync(tree)) continue
  const target = join(tree, 'bare-crypto')
  rmSync(target, { recursive: true, force: true })
  cpSync(shim, target, { recursive: true })
  console.log(`shimmed ${target}`)
}
