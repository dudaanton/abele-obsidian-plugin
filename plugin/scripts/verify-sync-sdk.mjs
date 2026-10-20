import { createHash } from 'node:crypto'
import { readFileSync, lstatSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => JSON.parse(readFileSync(file, 'utf8'))
// Inventory generated from the npm archive after verifying its audited SHA-512 integrity.
export const SDK_INPUT = read(join(plugin, 'scripts/sync-sdk-inputs.json'))
export function verifySyncSdkInputs(root = plugin) {
  if (
    [
      'package.json',
      'dist/internal/core/index.js',
      'dist/internal/core/index.d.ts',
      'dist/internal/protocol/index.js',
      'dist/internal/protocol/index.d.ts',
      'dist/notes/index.js',
      'dist/notes/index.d.ts',
    ].some((file) => !SDK_INPUT.files?.[file])
  )
    throw new Error('Incomplete sync SDK inventory')
  root = realpathSync(root)
  const name = '@abele/sync-sdk'
  const manifest = read(join(root, 'package.json'))
  const lock = read(join(root, 'package-lock.json'))
  const locked = lock.packages?.[`node_modules/${name}`]
  const retired = ['@abele/sync-core', '@abele/sync-protocol', '@abele/notes']
  if (
    retired.some(
      (name) =>
        manifest.dependencies?.[name] ||
        Object.keys(lock.packages ?? {}).some((path) => path.endsWith(`node_modules/${name}`))
    )
  )
    throw new Error('Retired sync package input remains')
  if (
    manifest.dependencies?.[name] !== SDK_INPUT.version ||
    locked?.version !== SDK_INPUT.version ||
    locked?.link ||
    locked?.resolved !==
      `https://registry.npmjs.org/@abele/sync-sdk/-/sync-sdk-${SDK_INPUT.version}.tgz` ||
    locked?.integrity !== SDK_INPUT.integrity
  )
    throw new Error('Unpinned sync SDK version, registry source or integrity')
  const installed = join(root, 'node_modules', name)
  if (lstatSync(installed).isSymbolicLink() || realpathSync(installed) !== resolve(installed))
    throw new Error('Linked sync SDK package refused')
  const payload = read(join(installed, 'package.json'))
  if (payload.name !== name || payload.version !== SDK_INPUT.version)
    throw new Error('Installed sync SDK revision mismatch')
  for (const [file, expected] of Object.entries(SDK_INPUT.files)) {
    const actual = createHash('sha256')
      .update(readFileSync(join(installed, file)))
      .digest('hex')
    if (actual !== expected) throw new Error(`Installed sync SDK input mismatch: ${file}`)
  }
  return SDK_INPUT
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifySyncSdkInputs()
  console.log('sync SDK: exact npm release, integrity and installed payload verified')
}
