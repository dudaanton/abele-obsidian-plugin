// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { cacheEntry, compilerCacheKey, lintCacheKeys } from '../../scripts/check-cache.mjs'
import { checkStrictNull } from '../../scripts/check-strict-null.mjs'

const roots: string[] = []
function fixture() {
  const temp = mkdtempSync(join(tmpdir(), 'sample-check-cache-'))
  roots.push(temp)
  const root = join(temp, 'repo')
  const plugin = join(root, 'plugin')
  mkdirSync(join(plugin, 'node_modules/typescript'), { recursive: true })
  mkdirSync(join(plugin, 'src/checked'), { recursive: true })
  mkdirSync(join(plugin, 'tests/unit'), { recursive: true })
  writeFileSync(join(root, 'manifest.json'), '{}')
  writeFileSync(
    join(plugin, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { noEmit: true, skipLibCheck: true },
      include: ['src/**/*.ts'],
    })
  )
  writeFileSync(join(plugin, 'strict-null-folders.json'), '["checked"]')
  writeFileSync(join(plugin, 'eslint.config.mjs'), 'export default []')
  writeFileSync(join(plugin, 'node_modules/typescript/package.json'), '{"version":"sample"}')
  writeFileSync(join(plugin, 'node_modules/typescript/compiler.js'), 'sample compiler')
  writeFileSync(join(plugin, 'src/checked/sample.ts'), 'export const value: string = "sample"')
  writeFileSync(join(plugin, 'tests/unit/sample.test.ts'), 'sample test')
  execFileSync('git', ['init', '-q', root])
  return { temp, root, plugin, cache: join(temp, 'cache') }
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('external check caches', () => {
  it('separates normal and strict programs, preserves source reuse, invalidates options and dependency payloads', () => {
    const f = fixture()
    const key = compilerCacheKey(f.root, 'normal', { noEmit: true })
    expect(compilerCacheKey(f.root, 'strict-null', { noEmit: true })).not.toBe(key)
    writeFileSync(join(f.plugin, 'src/checked/sample.ts'), 'export const value: string = null')
    expect(compilerCacheKey(f.root, 'normal', { noEmit: true })).toBe(key)
    expect(compilerCacheKey(f.root, 'normal', { noEmit: false })).not.toBe(key)
    writeFileSync(join(f.plugin, 'node_modules/typescript/compiler.js'), 'changed compiler')
    expect(compilerCacheKey(f.root, 'normal', { noEmit: true })).not.toBe(key)
  })

  it('separates compiler caches for different runtime module conditions', () => {
    const f = fixture()
    const script = `import { compilerCacheKey } from ${JSON.stringify(new URL('../../scripts/check-cache.mjs', import.meta.url).href)}; console.log(compilerCacheKey(${JSON.stringify(f.root)}, 'normal', { noEmit: true }))`
    const run = (flags: string[]) =>
      execFileSync(process.execPath, [...flags, '--input-type=module', '-e', script], {
        encoding: 'utf8',
      }).trim()
    expect(run(['--conditions=sample-check'])).not.toBe(run([]))
  })

  it('invalidates typed lint for imported source, new inputs, manifest and installed rule changes, not just linted-file contents', () => {
    const f = fixture()
    const before = lintCacheKeys(f.root)
    writeFileSync(join(f.plugin, 'src/checked/sample.ts'), 'export const value: string = null')
    const source = lintCacheKeys(f.root)
    expect(source.typed).not.toBe(before.typed)
    expect(source.untyped).toBe(before.untyped)
    writeFileSync(join(f.plugin, 'tests/unit/new.test.ts'), 'another test')
    expect(lintCacheKeys(f.root).typed).not.toBe(source.typed)
    writeFileSync(join(f.root, 'manifest.json'), '{"version":"1"}')
    const manifest = lintCacheKeys(f.root)
    expect(manifest.typed).not.toBe(source.typed)
    expect(manifest.untyped).not.toBe(source.untyped)
    writeFileSync(join(f.plugin, 'node_modules/typescript/compiler.js'), 'changed installed rule')
    expect(lintCacheKeys(f.root).untyped).not.toBe(manifest.untyped)
  })

  it('includes ignored but imported program inputs in the complete typed lint identity', () => {
    const f = fixture()
    writeFileSync(join(f.root, '.gitignore'), 'plugin/src/checked/generated.ts\n')
    writeFileSync(
      join(f.plugin, 'src/checked/generated.ts'),
      'export const value: string = "sample"'
    )
    const before = lintCacheKeys(f.root)
    writeFileSync(join(f.plugin, 'src/checked/generated.ts'), 'export const value: number = 1')
    expect(lintCacheKeys(f.root).typed).not.toBe(before.typed)
  })

  it('fingerprints imported program inputs outside the checkout', () => {
    const f = fixture()
    writeFileSync(join(f.temp, 'external.ts'), 'export const value: string = "sample"')
    writeFileSync(
      join(f.plugin, 'src/checked/sample.ts'),
      'import { value } from "../../../../external"; export const result: string = value'
    )
    const before = lintCacheKeys(f.root)
    writeFileSync(join(f.temp, 'external.ts'), 'export const value: number = 1')
    expect(lintCacheKeys(f.root).typed).not.toBe(before.typed)
  })

  it('invalidates content lint for nested formatter configuration', () => {
    const f = fixture()
    const before = lintCacheKeys(f.root)
    writeFileSync(join(f.plugin, 'tests/.prettierrc.json'), '{"semi":false}')
    expect(lintCacheKeys(f.root).untyped).not.toBe(before.untyped)
  })

  it('rejects caches inside the checkout, stays cold on contention, and releases only its own lease', () => {
    const f = fixture()
    expect(() =>
      cacheEntry(f.root, 'normal', 'sample', { ABELE_CHECK_CACHE_DIR: join(f.root, '.cache') })
    ).toThrow()
    const env = { ABELE_CHECK_CACHE_DIR: f.cache }
    const first = cacheEntry(f.root, 'normal', 'sample', env)
    expect(first).not.toBeNull()
    expect(cacheEntry(f.root, 'normal', 'sample', env)).toBeNull()
    first.release()
    const second = cacheEntry(f.root, 'normal', 'sample', env)
    expect(second).not.toBeNull()
    second.release()
    expect(cacheEntry(f.root, 'normal', 'sample', { ...env, ABELE_CHECK_COLD: '1' })).toBeNull()
    expect(cacheEntry(f.root, 'normal', 'sample', {})).toBeNull()
  })

  it('reuses only sealed successful output and misses on corruption or failed updates', () => {
    const f = fixture()
    const env = { ABELE_CHECK_CACHE_DIR: f.cache }
    const initial = cacheEntry(f.root, 'normal', 'sample', env)
    writeFileSync(initial.path, 'sample build info')
    initial.release(true)
    const warm = cacheEntry(f.root, 'normal', 'sample', env)
    expect(readFileSync(warm.path, 'utf8')).toBe('sample build info')
    writeFileSync(warm.path, 'failed update')
    warm.release(false)
    const retained = cacheEntry(f.root, 'normal', 'sample', env)
    expect(readFileSync(retained.path, 'utf8')).toBe('sample build info')
    retained.release()
    writeFileSync(join(f.cache, 'normal/sample/data'), 'corrupted info')
    const corrupt = cacheEntry(f.root, 'normal', 'sample', env)
    expect(existsSync(corrupt.path)).toBe(false)
    corrupt.release()
  })

  it('uses the normal incremental compiler without hiding changed imported types', () => {
    const f = fixture()
    writeFileSync(
      join(f.plugin, 'src/checked/service.ts'),
      'export const sample = (): string => "sample"'
    )
    writeFileSync(
      join(f.plugin, 'src/checked/sample.ts'),
      'import { sample } from "./service"; const result: string = sample()'
    )
    const identity = compilerCacheKey(f.root, 'normal', { noEmit: true, skipLibCheck: true })
    const run = (cold = false) => {
      const entry = cacheEntry(f.root, 'normal', identity, {
        ABELE_CHECK_CACHE_DIR: f.cache,
        ...(cold ? { ABELE_CHECK_COLD: '1' } : {}),
      })
      try {
        execFileSync(
          process.execPath,
          [
            join(process.cwd(), 'node_modules/typescript/bin/tsc'),
            '--noEmit',
            '--skipLibCheck',
            ...(entry ? ['--incremental', '--tsBuildInfoFile', entry.path] : []),
          ],
          { cwd: f.plugin, stdio: 'pipe' }
        )
        entry?.release(true)
        return ''
      } catch (error: any) {
        return String(error.stdout)
      } finally {
        entry?.release()
      }
    }
    expect(run()).toBe('')
    writeFileSync(join(f.plugin, 'src/checked/service.ts'), 'export const sample = (): number => 1')
    const warm = run()
    expect(warm).toContain('TS2322')
    expect(run(true)).toBe(warm)
    writeFileSync(
      join(f.plugin, 'src/checked/service.ts'),
      'export const sample = (): string => "fixed"'
    )
    expect(run()).toBe('')
  })

  it('persists strict-null build info, but still reports newly introduced errors on warm and cold runs', () => {
    const f = fixture()
    const info = join(f.cache, 'strict-null.tsbuildinfo')
    mkdirSync(f.cache)
    expect(checkStrictNull(f.plugin, info).diagnostics).toHaveLength(0)
    expect(existsSync(info)).toBe(true)
    writeFileSync(join(f.plugin, 'src/checked/sample.ts'), 'export const value: string = null')
    const warm = checkStrictNull(f.plugin, info).diagnostics
    const cold = checkStrictNull(f.plugin).diagnostics
    expect(warm.map((d: any) => d.code)).toEqual(cold.map((d: any) => d.code))
    expect(warm.some((d: any) => d.code === 2322)).toBe(true)
    writeFileSync(join(f.plugin, 'src/checked/sample.ts'), 'export const value: string = "fixed"')
    expect(checkStrictNull(f.plugin, info).diagnostics).toHaveLength(0)
  })
})
