#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inputIdentity, invalidateTypes, recordTypes, requireTypes } from './build-inputs.mjs'
import { cacheEntry, compilerCacheKey } from './check-cache.mjs'

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(plugin, '..')
const require = createRequire(import.meta.url)
const run = (script, args = []) =>
  execFileSync(process.execPath, [script, ...args], { cwd: plugin, stdio: 'inherit' })
const action = process.argv[2]
if (action === 'types') {
  invalidateTypes(root)
  const before = inputIdentity(root)
  let cache
  if (process.env.ABELE_CHECK_CACHE_DIR && process.env.ABELE_CHECK_COLD !== '1') {
    const { default: ts } = await import('typescript')
    const configPath = resolve(plugin, 'tsconfig.json')
    const config = ts.readConfigFile(configPath, ts.sys.readFile)
    const parsed = ts.parseJsonConfigFileContent(
      config.config ?? {},
      ts.sys,
      plugin,
      { noEmit: true, skipLibCheck: true },
      configPath
    )
    cache = cacheEntry(root, 'normal', compilerCacheKey(root, 'normal', parsed.options))
  }
  const started = Date.now()
  try {
    run(require.resolve('typescript/bin/tsc'), [
      '--noEmit',
      '--skipLibCheck',
      ...(cache ? ['--incremental', '--tsBuildInfoFile', cache.path] : []),
    ])
    cache?.release(true)
  } finally {
    cache?.release()
    console.log(`normal types: ${((Date.now() - started) / 1000).toFixed(3)}s`)
  }
  const strictStarted = Date.now()
  try {
    run(resolve(plugin, 'scripts/check-strict-null.mjs'))
  } finally {
    console.log(`strict-null types: ${((Date.now() - strictStarted) / 1000).toFixed(3)}s`)
  }
  recordTypes(root, before)
} else if (action === 'build') {
  const mode = process.argv[3] ?? 'production'
  if (!['production', 'sharing-test'].includes(mode)) throw new Error('Unknown build mode')
  requireTypes(root)
  run(resolve(plugin, 'scripts/verify-sync-sdk.mjs'))
  run(resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), [
    'build',
    '--mode',
    mode,
  ])
} else {
  throw new Error('Expected types or build')
}
