// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { runLint } from '../../scripts/check-lint.mjs'

const roots: string[] = []
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  vi.unstubAllEnvs()
})
function fixture() {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'sample-lint-')))
  roots.push(temp)
  const root = join(temp, 'repo')
  mkdirSync(join(root, 'plugin/src'), { recursive: true })
  mkdirSync(join(root, 'plugin/tests/unit'), { recursive: true })
  mkdirSync(join(root, 'plugin/node_modules'), { recursive: true })
  writeFileSync(join(root, 'manifest.json'), '{}')
  writeFileSync(join(root, 'plugin/node_modules/.package-lock.json'), '{}')
  writeFileSync(
    join(root, 'plugin/tsconfig.json'),
    '{"compilerOptions":{"strict":true},"include":["src/**/*.ts"]}'
  )
  const dependency = pathToFileURL(createRequire(import.meta.url).resolve('typescript-eslint')).href
  writeFileSync(
    join(root, 'plugin/eslint.config.mjs'),
    `
import tseslint from ${JSON.stringify(dependency)}
if (process.cwd() !== ${JSON.stringify(root)}) throw new Error('Configuration loaded before entering repository root')
export const nonTypedPatterns = ['plugin/tests/**']
export default [
 { ignores: ['plugin/node_modules/**', 'plugin/eslint.config.mjs'] },
 { files: ['plugin/src/**/*.ts'], languageOptions: { parser: tseslint.parser, parserOptions: { project: './plugin/tsconfig.json', tsconfigRootDir: ${JSON.stringify(root)} } }, plugins: { '@typescript-eslint': tseslint.plugin }, rules: { '@typescript-eslint/no-floating-promises': 'error' } },
 { files: ['plugin/tests/**/*.js'], rules: { 'no-undef': 'error' } }
]
`
  )
  writeFileSync(join(root, 'plugin/src/service.ts'), 'export function sample(): void {}')
  writeFileSync(
    join(root, 'plugin/src/consumer.ts'),
    'import { sample } from "./service"; sample()'
  )
  writeFileSync(join(root, 'plugin/tests/unit/sample.test.js'), 'const sample = 1')
  execFileSync('git', ['init', '-q', root])
  return { root, env: { ABELE_CHECK_CACHE_DIR: join(temp, 'cache') } }
}

describe('cached lint execution', () => {
  it('loads root-sensitive configuration only after changing directory and retains disjoint complete coverage', async () => {
    const f = fixture()
    const original = process.cwd()
    const result = await runLint(f.root, f.env)
    expect(process.cwd()).toBe(original)
    expect(result.errorCount).toBe(0)
    expect(result.files.sort()).toEqual([
      'plugin/src/consumer.ts',
      'plugin/src/service.ts',
      'plugin/tests/unit/sample.test.js',
    ])
    expect(new Set(result.files).size).toBe(result.files.length)
    expect((await runLint(f.root, f.env)).files.sort()).toEqual(result.files.sort())
  })

  it('rechecks unchanged consumers when an imported return type changes, matching a cold lint run', async () => {
    vi.stubEnv('CI', 'true')
    const f = fixture()
    expect((await runLint(f.root, f.env)).errorCount).toBe(0)
    writeFileSync(
      join(f.root, 'plugin/src/service.ts'),
      'export async function sample(): Promise<void> {}'
    )
    const warm = await runLint(f.root, f.env)
    const cold = await runLint(f.root, { ...f.env, ABELE_CHECK_COLD: '1' })
    expect(warm.errorCount).toBe(1)
    expect(cold.errorCount).toBe(warm.errorCount)
  })

  it('rechecks edited non-type files by content, matching cold results', async () => {
    const f = fixture()
    expect((await runLint(f.root, f.env)).errorCount).toBe(0)
    writeFileSync(join(f.root, 'plugin/tests/unit/sample.test.js'), 'unknownSample()')
    expect((await runLint(f.root, f.env)).errorCount).toBe(1)
    expect((await runLint(f.root, { ...f.env, ABELE_CHECK_COLD: '1' })).errorCount).toBe(1)
  })
})
