#!/usr/bin/env node
import { ESLint } from 'eslint'
import { createRequire } from 'node:module'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cacheEntry, lintCacheKeys } from './check-cache.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export async function runLint(checkout = root, env = process.env, oneShot = false) {
  const previousCwd = process.cwd()
  const previousSingleRun = process.env.TSESTREE_SINGLE_RUN
  // Repeated API calls are not ESLint fix iterations: single-run parsing would replace
  // imported type information with an isolated program. The CLI is genuinely one-shot.
  if (!oneShot) process.env.TSESTREE_SINGLE_RUN = 'false'
  process.chdir(checkout)
  const leases = []
  let parser
  let success = false
  try {
    // Independent invocations must not inherit the parser's in-process program snapshot.
    // Resolve the parser through its owning declared dependency, not an assumed hoist.
    const require = createRequire(import.meta.url)
    parser = createRequire(require.resolve('typescript-eslint'))('@typescript-eslint/parser')
    parser.clearCaches()
    // Obsidian's rules read the manifest at import time, not only during linting.
    const { nonTypedPatterns } = await import(
      pathToFileURL(resolve(checkout, 'plugin/eslint.config.mjs')).href
    )
    const cached = env.ABELE_CHECK_CACHE_DIR && env.ABELE_CHECK_COLD !== '1'
    const before = cached ? lintCacheKeys(checkout) : null
    let errorCount = 0
    const files = []
    for (const tier of ['untyped', 'typed']) {
      const cache = cached ? cacheEntry(checkout, `lint-${tier}`, before[tier], env) : null
      if (cache) leases.push(cache)
      const eslint = new ESLint({
        cwd: checkout,
        overrideConfigFile: resolve(checkout, 'plugin/eslint.config.mjs'),
        // These optional non-type blocks need not all exist in every checkout.
        errorOnUnmatchedPattern: false,
        ...(tier === 'typed' ? { ignorePatterns: nonTypedPatterns } : {}),
        ...(cache ? { cache: true, cacheStrategy: 'content', cacheLocation: cache.path } : {}),
      })
      const started = Date.now()
      const results = await eslint.lintFiles(tier === 'typed' ? ['.'] : nonTypedPatterns)
      const formatter = await eslint.loadFormatter('stylish')
      const output = formatter.format(results)
      if (output) console.log(output)
      console.log(`${tier} lint: ${((Date.now() - started) / 1000).toFixed(3)}s`)
      errorCount += results.reduce((sum, result) => sum + result.errorCount, 0)
      files.push(
        ...results.map((result) => relative(checkout, result.filePath).split(sep).join('/'))
      )
    }
    if (cached && JSON.stringify(lintCacheKeys(checkout)) !== JSON.stringify(before))
      throw new Error('Lint inputs changed during verification')
    success = errorCount === 0
    return { errorCount, files }
  } finally {
    try {
      for (const lease of leases) lease.release(success)
    } finally {
      parser?.clearCaches()
      process.chdir(previousCwd)
      if (previousSingleRun === undefined) delete process.env.TSESTREE_SINGLE_RUN
      else process.env.TSESTREE_SINGLE_RUN = previousSingleRun
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runLint(root, process.env, true)
  if (result.errorCount) process.exitCode = 1
}
