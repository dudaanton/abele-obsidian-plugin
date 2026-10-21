/**
 * The production `main.js` stays inside its budget, and the build says where its bytes go.
 *
 * Obsidian reads and compiles the whole file on every start, on a phone too, so every byte in
 * it is paid for at load whether the feature behind it is used or not. The budget is in
 * `tests/size/budget.json`; raising it is a decision, made in the same diff as whatever needed
 * the room. The per-package breakdown goes to `/tmp/abele-bundle-size.json` and the top of it
 * to the console — see `scripts/bundle-size.mjs` for how it is counted.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'

interface Budget {
  mainJsBytes: number
  stylesBytes: number
}

interface Report {
  mainJsBytes: number
  stylesBytes: number
  files: string[]
  runtimeElements: { script: number; style: number }
  byPackage: Array<{ name: string; bytes: number; share: number }>
  packageCopies: Record<string, number>
}

const root = path.resolve(__dirname, '../..')
const budget = JSON.parse(readFileSync(path.join(__dirname, 'budget.json'), 'utf8')) as Budget

let report: Report

describe('bundle size', () => {
  beforeAll(async () => {
    // A process of its own: built inside the test runner, the bundle comes out larger than the
    // one `npm run build` ships, and the budget would be measured against the wrong file.
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [path.join(root, 'scripts/bundle-size.mjs'), '--json'],
      { cwd: root, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NODE_ENV: 'production' } }
    )
    report = JSON.parse(stdout) as Report
    console.info(`Emitted bytes: main.js ${report.mainJsBytes}; CSS ${report.stylesBytes}`)
    writeFileSync(
      path.join(tmpdir(), 'abele-bundle-size.json'),
      JSON.stringify({ ...report, budget }, null, 2)
    )

    const kb = (n: number) => `${(n / 1024).toFixed(0).padStart(6)} KB`
    console.info(
      [
        '',
        `  main.js ${kb(report.mainJsBytes)} of ${kb(budget.mainJsBytes)}   ` +
          `styles ${kb(report.stylesBytes)} of ${kb(budget.stylesBytes)}`,
        ...report.byPackage
          .slice(0, 15)
          .map((p) => `  ${kb(p.bytes)}  ${(p.share * 100).toFixed(1).padStart(5)}%  ${p.name}`),
        '',
      ].join('\n')
    )
  }, 180_000)

  it('keeps main.js inside its budget', () => {
    expect(report.mainJsBytes).toBeGreaterThan(0)
    expect(report.mainJsBytes).toBeLessThanOrEqual(budget.mainJsBytes)
  })

  it('ships non-English catalogs only as versioned assets whose hashes are bundled', () => {
    const dir = path.resolve(root, process.env.ABELE_BUILD_ARTIFACT ?? 'build')
    const code = readFileSync(path.join(dir, 'main.js'), 'utf8')
    expect(code.includes('Звуковая волна')).toBe(false)
    expect(code.includes('\\u0417\\u0432\\u0443')).toBe(false)
    const { version } = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
    for (const language of ['ru', 'lv', 'es', 'de']) {
      const name = `abele-i18n-${language}.json`
      expect(report.files).toContain(name)
      const text = readFileSync(path.join(dir, name), 'utf8')
      const payload = JSON.parse(text)
      expect(payload.version).toBe(version)
      expect(payload.language).toBe(language)
      expect(Object.keys(payload.catalog).length).toBeGreaterThan(100)
      expect(code.includes(createHash('sha256').update(text).digest('hex'))).toBe(true)
    }
  })

  it('keeps the stylesheet inside its budget', () => {
    expect(report.stylesBytes).toBeGreaterThan(0)
    expect(report.stylesBytes).toBeLessThanOrEqual(budget.stylesBytes)
  })

  it('does not create script elements, even in unreachable dependency polyfills', () => {
    expect(report.runtimeElements.script).toBe(0)
  })

  it('does not add runtime style creation beyond the existing feature exceptions', () => {
    // Existing calls: dom-to-image-more (2), foliate (3), style-mod fallback (1),
    // script views (1), snippets (1), slides (1), isolated reader/Word documents (3).
    // These are existing feature exceptions, not a claim that runtime styles are absent.
    // MapLibre's static CSS is already guarded by tests/harness/mapStylesheet.test.ts.
    expect(report.runtimeElements.style).toBeLessThanOrEqual(12)
  })

  it('excludes the test-only catalogue and its entire fixture graph from production', () => {
    // The production graph guard additionally checks individual rendered module IDs.
    expect(report.byPackage.some((p) => p.name === 'src/testing')).toBe(false)
  })

  it('ships each package once, apart from zod 4 beside the one zod 3 the vendored packages share', () => {
    // npm nests a zod 3 under every vendored `@abele/*` package; the build resolves them to one.
    expect(report.packageCopies).toEqual({ zod: 2 })
  })

  it('keeps private class members native rather than down-levelled for engines Obsidian dropped', () => {
    // Below Chrome 91 / Safari 15 esbuild rewrites `#field` into WeakMap helpers whose error
    // text survives minification; the build target keeps them out (about 150 KB).
    const dir = path.resolve(root, process.env.ABELE_BUILD_ARTIFACT ?? 'build')
    const code = readFileSync(path.join(dir, 'main.js'), 'utf8')
    expect(code.includes('read from private field')).toBe(false)
    expect(code.includes('Cannot add the same private member')).toBe(false)
  })

  it('leaves out HyperFormula’s function descriptions, which only its unused list API reads', () => {
    const dir = path.resolve(root, process.env.ABELE_BUILD_ARTIFACT ?? 'build')
    const code = readFileSync(path.join(dir, 'main.js'), 'utf8')
    expect(code.includes('Returns the average deviation of the arguments')).toBe(false)
    expect(code.includes('hyperformula.handsontable.com/docs/guide/built-in-functions')).toBe(false)
  })

  it('attributes the bundle to packages, so a jump can be traced to what caused it', () => {
    expect(report.byPackage.length).toBeGreaterThan(5)
    expect(report.byPackage.some((p) => p.name === '@vue/runtime-core')).toBe(true)
  })
})
