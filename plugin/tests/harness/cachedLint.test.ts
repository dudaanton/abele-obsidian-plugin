// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
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
function dependency(name: string) {
  return pathToFileURL(createRequire(import.meta.url).resolve(name)).href
}
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
    '{"compilerOptions":{"strict":true,"lib":["ES2022"],"types":[]},"include":["src/**/*.ts"]}'
  )
  writeFileSync(
    join(root, 'plugin/eslint.config.mjs'),
    `
import tseslint from ${JSON.stringify(dependency('typescript-eslint'))}
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
type Fixture = ReturnType<typeof fixture>
async function comparison(f: Fixture) {
  // The source is frozen for both independent invocations; their fresh workers may overlap.
  return Promise.all([runLint(f.root, f.env), runLint(f.root, { ...f.env, ABELE_CHECK_COLD: '1' })])
}
const api = `export declare class Component { unload(): void }
export declare class Plugin extends Component { id: string }
export declare class MarkdownRenderer { static render(app: unknown, text: string, element: unknown, path: string, component: Component): Promise<void> }
export declare const sampleComponent: `

describe('cached lint execution', () => {
  // Setup retains a five-second deadline; a warm-plus-cold comparison of two real lints gets
  // twenty, so a loaded check machine does not read as a regression. Seeding is a checked
  // fixture prerequisite, not three serial full parser bootstraps inside one assertion phase.
  describe.each(['generated', 'external'])('Vue-only %s declarations', (location) => {
    let f: Fixture
    let declaration: string
    beforeEach(async () => {
      f = fixture()
      mkdirSync(join(f.root, 'plugin/build'))
      writeFileSync(
        join(f.root, 'plugin/tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            moduleResolution: 'bundler',
            module: 'ESNext',
            lib: ['ES2022'],
            types: [],
          },
          include: ['src/**/*.ts', 'src/**/*.vue'],
        })
      )
      declaration =
        location === 'generated'
          ? join(f.root, 'plugin/build/sample-api.d.ts')
          : join(f.root, '../sample-api.d.ts')
      writeFileSync(declaration, api + 'Component;')
      writeFileSync(
        join(f.root, 'plugin/src/sample.vue'),
        `<script setup lang="ts">
import { MarkdownRenderer, sampleComponent } from '${location === 'generated' ? '../build/sample-api' : '../../../sample-api'}';
MarkdownRenderer.render(null, 'sample', null, '', sampleComponent);
</script><template><div /></template>`
      )
      writeFileSync(
        join(f.root, 'plugin/eslint.config.mjs'),
        `
import tseslint from ${JSON.stringify(dependency('typescript-eslint'))};
import vueParser from ${JSON.stringify(dependency('vue-eslint-parser'))};
import obsidianmd from ${JSON.stringify(dependency('eslint-plugin-obsidianmd'))};
export const nonTypedPatterns = ['plugin/tests/**'];
export default [
 { ignores: ['plugin/node_modules/**', 'plugin/build/**', 'plugin/eslint.config.mjs'] },
 { files: ['plugin/src/**/*.vue'], languageOptions: { parser: vueParser, parserOptions: { parser: tseslint.parser, projectService: true, tsconfigRootDir: ${JSON.stringify(f.root + '/plugin')}, extraFileExtensions: ['.vue'] } }, plugins: { obsidianmd: obsidianmd.plugin ?? obsidianmd }, rules: { 'obsidianmd/no-plugin-as-component': 'error' } }
];`
      )
      expect((await runLint(f.root, f.env)).errorCount).toBe(0)
      expect(existsSync(join(f.env.ABELE_CHECK_CACHE_DIR, 'lint-typed'))).toBe(false)
      writeFileSync(declaration, api + 'Plugin;')
    }, 30_000)
    it('rechecks imported types omitted by plain TypeScript against cold lint', async () => {
      const [warm, cold] = await comparison(f)
      expect(cold.errorCount).toBe(1)
      expect(warm.errorCount).toBe(cold.errorCount)
    }, 30_000)
  })

  describe('manifest-dependent rule state', () => {
    let f: Fixture
    beforeEach(async () => {
      f = fixture()
      writeFileSync(join(f.root, 'manifest.json'), '{"isDesktopOnly":true}')
      writeFileSync(join(f.root, 'plugin/src/sample.js'), 'export const sample = /(?<=sample)text/')
      writeFileSync(
        join(f.root, 'plugin/eslint.config.mjs'),
        `
import obsidianmd from ${JSON.stringify(dependency('eslint-plugin-obsidianmd'))};
export const nonTypedPatterns = ['plugin/tests/**'];
export default [
 { ignores: ['plugin/node_modules/**', 'plugin/eslint.config.mjs'] },
 { files: ['plugin/src/**/*.js'], plugins: { obsidianmd: obsidianmd.plugin ?? obsidianmd }, rules: { 'obsidianmd/regex-lookbehind': 'error' } }
];`
      )
      expect((await runLint(f.root, f.env)).errorCount).toBe(0)
      writeFileSync(join(f.root, 'manifest.json'), '{"isDesktopOnly":false}')
    }, 30_000)
    it('reloads rule state before computing and sealing a new input result', async () => {
      const [warm, cold] = await comparison(f)
      expect(warm.errorCount).toBe(1)
      expect(cold.errorCount).toBe(1)
    }, 30_000)
  })

  describe('root-sensitive configuration', () => {
    let f: Fixture
    let first: Awaited<ReturnType<typeof runLint>>
    beforeEach(async () => {
      f = fixture()
      const original = process.cwd()
      first = await runLint(f.root, f.env)
      expect(process.cwd()).toBe(original)
      expect(first.errorCount).toBe(0)
      expect(first.files.sort()).toEqual([
        'plugin/src/consumer.ts',
        'plugin/src/service.ts',
        'plugin/tests/unit/sample.test.js',
      ])
      expect(new Set(first.files).size).toBe(first.files.length)
    }, 30_000)
    it('retains disjoint complete coverage on repeated calls', async () => {
      expect((await runLint(f.root, f.env)).files.sort()).toEqual(first.files.sort())
    }, 30_000)
  })

  describe('imported return type changes', () => {
    let f: Fixture
    beforeEach(async () => {
      vi.stubEnv('CI', 'true')
      f = fixture()
      expect((await runLint(f.root, f.env)).errorCount).toBe(0)
      writeFileSync(
        join(f.root, 'plugin/src/service.ts'),
        'export async function sample(): Promise<void> {}'
      )
    }, 30_000)
    it('rechecks unchanged consumers, matching cold results', async () => {
      const [warm, cold] = await comparison(f)
      expect(warm.errorCount).toBe(1)
      expect(cold.errorCount).toBe(warm.errorCount)
    }, 20000)
  })

  describe('non-type file changes', () => {
    let f: Fixture
    beforeEach(async () => {
      f = fixture()
      expect((await runLint(f.root, f.env)).errorCount).toBe(0)
      writeFileSync(join(f.root, 'plugin/tests/unit/sample.test.js'), 'unknownSample()')
    }, 30_000)
    it('rechecks edited files by content, matching cold results', async () => {
      const [warm, cold] = await comparison(f)
      expect(warm.errorCount).toBe(1)
      expect(cold.errorCount).toBe(1)
    }, 20000)
  })
})
