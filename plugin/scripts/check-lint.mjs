#!/usr/bin/env node
import { ESLint } from 'eslint'
import { fork } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cacheEntry, lintCacheKeys } from './check-cache.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// Node module caches belong to a process, not a checkout or lint input key. Each API call
// gets fresh rule/config state, just like independent CLI invocations.
export function runLint(checkout = root, env = process.env) {
  const execArgv = []
  for (let index = 0; index < process.execArgv.length; index++) {
    const arg = process.execArgv[index]
    if (['-e', '--eval', '-p', '--print', '--input-type'].includes(arg)) {
      index++
      continue
    }
    if (/^(?:--(?:eval|print|input-type)=|-e.+|-p.+)/.test(arg)) continue
    execArgv.push(arg)
  }
  return new Promise((resolveResult, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ['--worker', resolve(checkout)], {
      cwd: checkout,
      env: { ...process.env, ...env },
      execArgv,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
    let message
    child.on('message', (value) => {
      message = value
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (
        code === 0 &&
        Number.isInteger(message?.result?.errorCount) &&
        Array.isArray(message?.result?.files)
      )
        resolveResult(message.result)
      else
        reject(
          new Error(
            message?.error ?? `Lint worker stopped (${signal ?? code}) without a complete result`
          )
        )
    })
  })
}

async function lintOnce(checkout = root, env = process.env) {
  const previousCwd = process.cwd()
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
    // Only non-type output can be cached. Do not construct an incomplete TS graph
    // merely to guard a typed result that will never be reused or sealed.
    const before = cached ? lintCacheKeys(checkout, false) : null
    let errorCount = 0
    const files = []
    for (const tier of ['untyped', 'typed']) {
      const reusable = tier === 'untyped' || before?.typedReusable === true
      const cache =
        cached && reusable ? cacheEntry(checkout, `lint-${tier}`, before[tier], env) : null
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
    if (cached && JSON.stringify(lintCacheKeys(checkout, false)) !== JSON.stringify(before))
      throw new Error('Lint inputs changed during verification')
    success = errorCount === 0
    return { errorCount, files }
  } finally {
    try {
      for (const lease of leases) lease.release(success)
    } finally {
      parser?.clearCaches()
      process.chdir(previousCwd)
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--worker' && process.connected) {
    try {
      const result = await lintOnce(resolve(process.argv[3]))
      process.send({ result }, () => process.disconnect())
    } catch (error) {
      process.exitCode = 1
      process.send({ error: String(error?.stack ?? error) }, () => process.disconnect())
    }
  } else {
    const result = await lintOnce()
    if (result.errorCount) process.exitCode = 1
  }
}
