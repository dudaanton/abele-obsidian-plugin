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

interface Budget {
  mainJsBytes: number
  stylesBytes: number
}

interface Report {
  mainJsBytes: number
  stylesBytes: number
  files: string[]
  byPackage: Array<{ name: string; bytes: number; share: number }>
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
    writeFileSync('/tmp/abele-bundle-size.json', JSON.stringify({ ...report, budget }, null, 2))

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

  it('keeps the stylesheet inside its budget', () => {
    expect(report.stylesBytes).toBeGreaterThan(0)
    expect(report.stylesBytes).toBeLessThanOrEqual(budget.stylesBytes)
  })

  it('attributes the bundle to packages, so a jump can be traced to what caused it', () => {
    expect(report.byPackage.length).toBeGreaterThan(5)
    expect(report.byPackage.some((p) => p.name === '@vue/runtime-core')).toBe(true)
  })
})
