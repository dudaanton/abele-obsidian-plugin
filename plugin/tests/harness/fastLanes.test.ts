// @vitest-environment node
import { expect, it } from 'vitest'
import config from '../../vitest.config'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

it('runs native scale fixtures after ordinary files with one worker per shard', () => {
  const projects = config.test?.projects as {
    extends: boolean
    test: {
      name: string
      include?: string[]
      exclude?: string[]
      fileParallelism?: boolean
      sequence?: { groupOrder: number }
    }
  }[]
  expect(projects).toHaveLength(2)
  const [ordinary, native] = projects
  expect(ordinary.extends).toBe(true)
  expect(native.extends).toBe(true)
  expect(native.test.fileParallelism).toBe(false)
  expect(native.test.sequence?.groupOrder).toBeGreaterThan(ordinary.test.sequence?.groupOrder ?? 0)
  expect(native.test.include).toContain('tests/integration/native*.test.ts')
  for (const pattern of native.test.include ?? []) expect(ordinary.test.exclude).toContain(pattern)
})

// Exercise Vitest's CLI override and worker scheduler, not just the configuration shape.
it(
  'keeps the native lane serial even when the train requests four workers',
  { timeout: 60_000 },
  () => {
    expect(config.test?.projects).toHaveLength(2)
    const directory = mkdtempSync(join(tmpdir(), 'sample-fast-lanes-'))
    const events = join(directory, 'events.jsonl')
    try {
      mkdirSync(join(directory, 'tests/unit'), { recursive: true })
      mkdirSync(join(directory, 'tests/integration'), { recursive: true })
      for (const [kind, folder, names] of [
        ['ordinary', 'unit', ['sampleOne', 'sampleTwo', 'sampleThree', 'sampleFour']],
        ['native', 'integration', ['nativeSampleOne', 'nativeSampleTwo', 'nativeSampleThree']],
      ] as const) {
        for (const name of names)
          writeFileSync(
            join(directory, `tests/${folder}/${name}.test.ts`),
            `import {appendFileSync} from 'node:fs';
test('sample work', async () => {
 const record = (event) => appendFileSync(${JSON.stringify(events)}, JSON.stringify({kind:${JSON.stringify(kind)},name:${JSON.stringify(name)},event})+'\\n');
 record('start'); await new Promise(resolve => setTimeout(resolve, 80)); record('end');
});`
          )
      }
      const settings = join(directory, 'vitest.config.mjs')
      writeFileSync(
        settings,
        'export default ' +
          JSON.stringify({
            test: {
              globals: true,
              environment: 'node',
              include: config.test?.include,
              projects: config.test?.projects,
            },
          })
      )
      execFileSync(
        process.execPath,
        [
          resolve('node_modules/vitest/vitest.mjs'),
          'run',
          `--config=${settings}`,
          `--root=${directory}`,
          '--maxWorkers=4',
        ],
        { env: { ...process.env, ABELE_FAST_SHARD_PLAN: '' }, stdio: 'pipe' }
      )
      const rows = readFileSync(events, 'utf8')
        .trim()
        .split('\n')
        .map(
          (line) =>
            JSON.parse(line) as {
              kind: string
              name: string
              event: string
            }
        )
      const active = new Set<string>()
      let finishedOrdinary = 0
      for (const row of rows) {
        if (row.kind === 'ordinary' && row.event === 'end') finishedOrdinary++
        if (row.kind !== 'native') continue
        expect(finishedOrdinary).toBe(4)
        if (row.event === 'start') {
          expect(active.size).toBe(0)
          active.add(row.name)
        } else expect(active.delete(row.name)).toBe(true)
      }
      expect(active.size).toBe(0)
      expect(rows).toHaveLength(14)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
)
