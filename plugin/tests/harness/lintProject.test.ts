// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { lintConcurrency } from '../../scripts/check-lint.mjs'

describe('typed lint project coverage', () => {
  it('includes every typed ESLint input, including Vue, in the explicit project', () => {
    // Resolve configuration only: never run a full lint or build a typed program here.
    // Manifest-dependent rules must load in the repository root.
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
import { ESLint } from './plugin/node_modules/eslint/lib/api.js'
import ts from './plugin/node_modules/typescript/lib/typescript.js'
import { readdirSync } from 'node:fs'
import { resolve, relative } from 'node:path'
const project = resolve('plugin/tsconfig.eslint.json')
const config = ts.readConfigFile(project, ts.sys.readFile)
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\\n'))
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve('plugin'), {}, project, undefined,
  [{ extension: '.vue', isMixedContent: true, scriptKind: ts.ScriptKind.Deferred }])
if (parsed.errors.length) throw new Error(JSON.stringify(parsed.errors))
const covered = new Set(parsed.fileNames.map(file => resolve(file)))
const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: resolve('plugin/eslint.config.mjs'), concurrency: 1 })
const missing = []
let typed = 0, vue = 0
async function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', '.codex-npm-cache', '.scratch'].includes(entry.name)) continue
      await walk(file)
    } else if (/\\.(?:[cm]?[jt]sx?|vue)$/.test(entry.name)) {
      const options = (await eslint.calculateConfigForFile(file))?.languageOptions?.parserOptions
      if (!options || (!options.project && !options.projectService)) continue
      typed++
      if (entry.name.endsWith('.vue')) vue++
      if (options.project !== './tsconfig.eslint.json' || options.tsconfigRootDir !== resolve('plugin') ||
          options.projectService || !options.extraFileExtensions?.includes('.vue') || !covered.has(file))
        missing.push(relative(process.cwd(), file))
    }
  }
}
await walk(process.cwd())
console.log(JSON.stringify({ missing, typed, vue }))
`,
      ],
      { cwd: resolve('..'), encoding: 'utf8' }
    )
    const result = JSON.parse(output.trim())
    expect(result.missing).toEqual([])
    expect(result.typed).toBeGreaterThan(0)
    expect(result.vue).toBeGreaterThan(0)
  }, 15000)
})

describe('lint concurrency', () => {
  it('defaults to four workers and accepts explicit limits or auto', () => {
    expect(lintConcurrency({})).toBe(4)
    expect(lintConcurrency({ ABELE_LINT_CONCURRENCY: '1' })).toBe(1)
    expect(lintConcurrency({ ABELE_LINT_CONCURRENCY: '2' })).toBe(2)
    expect(lintConcurrency({ ABELE_LINT_CONCURRENCY: 'auto' })).toBe('auto')
  })
  it.each(['', '0', '-1', '1.5', 'NaN', 'off', '9007199254740992'])(
    'rejects invalid worker limit %s',
    (value) => {
      expect(() => lintConcurrency({ ABELE_LINT_CONCURRENCY: value })).toThrow(
        'ABELE_LINT_CONCURRENCY'
      )
    }
  )
})
