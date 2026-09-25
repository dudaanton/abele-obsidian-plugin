// Bundles the lab server with the project's own esbuild and starts it: no other tool needed.
import { build } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// Beside the project's node_modules, so the bundle finds esbuild and fflate there.
const out = join(here, '../../node_modules/.cache/abele-ios-server.mjs')
await build({
  entryPoints: [join(here, 'server.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: out,
  logLevel: 'warning',
})
process.env.LAB_DIR = here
await import(out)
