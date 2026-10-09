import { expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const probe = vi.hoisted(() => ({
  bugs: {
    rows: 'line-alignment',
    states: 'native-parity',
    details: 'clipping',
    images: 'line-alignment',
    events: 'hierarchy-order',
    artifact: 'row-column',
    'comment-thread': 'row-spacing',
    waiting: 'text-left-edge',
    controls: 'clipping',
    navigation: 'row-column',
    previews: 'spacing-scale',
    specialized: 'sibling-overlap',
    'icon-picker': 'sibling-overlap',
    confirm: 'sibling-overlap',
  } as Record<string, string>,
  measurements: [] as { page: string; rules: unknown }[],
}))
vi.mock('../e2e/helpers/obsidianCli', () => ({
  evalJson: vi.fn(() => true),
  evalLong: vi.fn(async (code: string) =>
    code.includes('openDesignCatalogue(') ? 'opened' : 'closed'
  ),
}))
vi.mock('../e2e/helpers/shots', () => ({ shotDir: () => 'fixture-evidence' }))
vi.mock('../e2e/helpers/designLint', () => ({
  measureDesign: vi.fn(
    async (_selector: string, directory: string, _capture: unknown, rules: unknown) => {
      const page = directory.split(/[\\/]/).at(-1)!
      probe.measurements.push({ page, rules })
      if (process.env.DESIGN_GATE_PROBE === 'capture-error' && page === 'waiting')
        throw new Error('Probe capture failed')
      const rule =
        process.env.DESIGN_GATE_PROBE === 'fixed' && page === 'waiting'
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
              : { metrics: { padding: [4, 8, 4, 8] } },
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
  expect(probe.measurements).toHaveLength(16)
  expect(
    probe.measurements.every((m) => JSON.stringify(m.rules) === '{"requireNative":true}')
  ).toBe(true)
  expect(
    probe.measurements
      .filter((m) => !(m.page in probe.bugs))
      .map((m) => m.page)
      .sort()
  ).toEqual(['comment', 'swatches'])
})
it('rejects a repaired BUG and does not hide capture errors as expected failures', () => {
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const cli = join(cwd, 'node_modules/vitest/vitest.mjs')
  const run = (state: string) =>
    spawnSync(
      process.execPath,
      [cli, 'run', 'tests/harness/designCatalogueGate.test.ts', '--maxWorkers=2', '-t', 'waiting'],
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
