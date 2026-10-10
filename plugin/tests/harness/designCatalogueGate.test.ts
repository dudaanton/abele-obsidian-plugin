import { expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const probe = vi.hoisted(() => ({
  bugs: {
    states: 'native-parity',
    details: 'clipping',
    images: 'line-alignment',
    controls: 'clipping',
    navigation: 'row-column',
    'icon-picker': 'sibling-overlap',
    confirm: 'sibling-overlap',
  } as Record<string, string>,
  measurements: [] as { page: string; capture: unknown; rules: unknown }[],
}))
// Inject synthetic outstanding debt into the real registration path. The live catalogue
// is clean, but capture errors, missing native references and unexpected BUG passes remain red.
vi.mock('../e2e/helpers/designCatalogueCases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../e2e/helpers/designCatalogueCases')>()
  return {
    DESIGN_CASES: actual.DESIGN_CASES.map((entry) => ({ ...entry, bug: probe.bugs[entry.page] })),
  }
})
vi.mock('../e2e/helpers/obsidianCli', () => ({
  evalJson: vi.fn(() => true),
  evalLong: vi.fn(async (code: string) =>
    code.includes("return 'ready'")
      ? 'ready'
      : code.includes("return 'restored'")
        ? 'restored'
        : code.includes('openDesignCatalogue(')
          ? 'opened'
          : 'closed'
  ),
}))
vi.mock('../e2e/helpers/shots', () => ({ shotDir: () => 'fixture-evidence' }))
vi.mock('../e2e/helpers/designLint', () => ({
  measureDesign: vi.fn(
    async (_selector: string, directory: string, capture: unknown, rules: unknown) => {
      const page = directory.split(/[\\/]/).at(-1)!
      probe.measurements.push({ page, capture, rules })
      if (process.env.DESIGN_GATE_PROBE === 'capture-error' && page === 'states')
        throw new Error('Probe capture failed')
      const rule =
        process.env.DESIGN_GATE_PROBE === 'fixed' && page === 'states'
          ? undefined
          : probe.bugs[page]
      return {
        directory,
        artifacts: [],
        snapshot: {
          elements: [{ id: 'fixture' }],
          native:
            process.env.DESIGN_GATE_PROBE === 'missing-reference'
              ? undefined
              : { kind: 'search-result', metrics: { padding: [4, 8, 4, 8] } },
        },
        violations: rule
          ? [{ rule, message: 'Synthetic measured violation', elements: ['fixture'], boxes: [] }]
          : [],
      }
    }
  ),
}))

// Collect the real live contract with synthetic transport, not a copy of its test registration.
await import('../e2e/designLint.e2e.test')

it('measures all catalogue pages with the unchanged native-reference requirement', () => {
  expect(probe.measurements).toHaveLength(17)
  expect(
    probe.measurements.every((m) => JSON.stringify(m.rules) === '{"requireNative":true}')
  ).toBe(true)
  expect(
    probe.measurements.every(
      (m) =>
        JSON.stringify(m.capture) ===
        JSON.stringify({
          nativeSelector: '[data-design-lint-reference] .backlink-pane .tree-item-self',
        })
    )
  ).toBe(true)
  expect(
    probe.measurements
      .filter((m) => !(m.page in probe.bugs))
      .map((m) => m.page)
      .sort()
  ).toEqual([
    'artifact',
    'comment',
    'comment-thread',
    'events',
    'index',
    'previews',
    'rows',
    'specialized',
    'swatches',
    'waiting',
  ])
})
it('registers every real catalogue page as an ordinary clean contract after measured repairs', async () => {
  const actual = await vi.importActual<typeof import('../e2e/helpers/designCatalogueCases')>(
    '../e2e/helpers/designCatalogueCases'
  )
  const { CATALOGUE_PAGES } = await import('@/testing/designCatalogue')
  expect(actual.DESIGN_CASES.map((entry) => entry.page)).toEqual([...CATALOGUE_PAGES])
  expect(actual.DESIGN_CASES.every((entry) => entry.bug === undefined)).toBe(true)
})
it('rejects a repaired BUG and does not hide capture errors as expected failures', () => {
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const cli = join(cwd, 'node_modules/vitest/vitest.mjs')
  const run = (state: string) =>
    spawnSync(
      process.execPath,
      [cli, 'run', 'tests/harness/designCatalogueGate.test.ts', '--maxWorkers=2', '-t', 'states'],
      {
        cwd,
        encoding: 'utf8',
        timeout: 30_000,
        env: { ...process.env, DESIGN_GATE_PROBE: state },
      }
    )
  const fixed = run('fixed')
  expect(fixed.error).toBeUndefined()
  expect(fixed.status).toBe(1)
  expect(fixed.stdout + fixed.stderr).toContain('Expect test to fail')
  const brokenCapture = run('capture-error')
  expect(brokenCapture.error).toBeUndefined()
  expect(brokenCapture.status).toBe(1)
  expect(brokenCapture.stdout + brokenCapture.stderr).toContain('Probe capture failed')
  const missingReference = run('missing-reference')
  expect(missingReference.error).toBeUndefined()
  expect(missingReference.status).toBe(1)
  expect(missingReference.stdout + missingReference.stderr).toContain(
    'A visible native reference pane is required'
  )
}, 90_000)
