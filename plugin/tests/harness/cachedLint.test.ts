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

function dependency(name: string) {
  return pathToFileURL(createRequire(import.meta.url).resolve(name)).href
}

function probe(root: string, env: object, body: string) {
  const script = `import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runLint } from ${JSON.stringify(new URL('../../scripts/check-lint.mjs', import.meta.url).href)};
const root = ${JSON.stringify(root)};
const env = ${JSON.stringify(env)};
${body}`
  execFileSync(process.execPath, ['--input-type=module', '-e', script], { stdio: 'pipe' })
}

describe('cached lint execution', () => {
  it.each(['generated', 'external'])(
    'rechecks Vue-only declarations in %s inputs omitted by plain TypeScript',
    (location) => {
      const f = fixture()
      mkdirSync(join(f.root, 'plugin/build'))
      writeFileSync(
        join(f.root, 'plugin/tsconfig.json'),
        JSON.stringify({
          // The synthetic API uses no DOM or ambient packages. Keep the complete rule
          // check, without repeatedly loading unrelated libraries in fresh processes.
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
      const api = `export declare class Component { unload(): void }
export declare class Plugin extends Component { id: string }
export declare class MarkdownRenderer { static render(app: unknown, text: string, element: unknown, path: string, component: Component): Promise<void> }
export declare const sampleComponent: `
      const declaration =
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
      probe(
        f.root,
        f.env,
        `
assert.equal((await runLint(root, env)).errorCount, 0);
assert.equal(existsSync(join(env.ABELE_CHECK_CACHE_DIR, 'lint-typed')), false, 'incomplete program inputs must never seed a typed cache');
writeFileSync(${JSON.stringify(declaration)}, ${JSON.stringify(api + 'Plugin;')});
// Independent invocations read the same frozen inputs; their fresh workers may overlap.
const [warm, cold] = await Promise.all([
  runLint(root, env), runLint(root, { ...env, ABELE_CHECK_COLD: '1' })
]);
assert.equal(cold.errorCount, 1, 'cold lint must detect the Vue-only imported Plugin');
assert.equal(warm.errorCount, cold.errorCount, 'warm lint must not reuse the old Component result');`
      )
    }
  )

  it('reloads manifest-dependent rule state before computing and sealing a new input result', () => {
    const f = fixture()
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
    probe(
      f.root,
      f.env,
      `
assert.equal((await runLint(root, env)).errorCount, 0);
writeFileSync(join(root, 'manifest.json'), '{"isDesktopOnly":false}');
const [warm, cold] = await Promise.all([
  runLint(root, env), runLint(root, { ...env, ABELE_CHECK_COLD: '1' })
]);
assert.equal(warm.errorCount, 1, 'changed manifest must reload rule module state');
assert.equal(cold.errorCount, 1);`
    )
  })

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
    const [warm, cold] = await Promise.all([
      runLint(f.root, f.env),
      runLint(f.root, { ...f.env, ABELE_CHECK_COLD: '1' }),
    ])
    expect(warm.errorCount).toBe(1)
    expect(cold.errorCount).toBe(warm.errorCount)
  })

  it('rechecks edited non-type files by content, matching cold results', async () => {
    const f = fixture()
    expect((await runLint(f.root, f.env)).errorCount).toBe(0)
    writeFileSync(join(f.root, 'plugin/tests/unit/sample.test.js'), 'unknownSample()')
    const [warm, cold] = await Promise.all([
      runLint(f.root, f.env),
      runLint(f.root, { ...f.env, ABELE_CHECK_COLD: '1' }),
    ])
    expect(warm.errorCount).toBe(1)
    expect(cold.errorCount).toBe(1)
  })
})
