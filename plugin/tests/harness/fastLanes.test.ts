// @vitest-environment node
import { expect, it } from 'vitest'
import config from '../../vitest.config'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function optedInProjects() {
  const script = `globalThis.__dirname = process.cwd(); const config = (await import('./vitest.config.ts')).default; console.log('SCALE_CONFIG=' + JSON.stringify(config.test.projects))`
  const output = execFileSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', script],
    {
      env: { ...process.env, ABELE_SCALE_TESTS: '1', ABELE_FAST_SHARD_PLAN: '' },
      encoding: 'utf8',
    }
  )
  return JSON.parse(output.slice(output.indexOf('SCALE_CONFIG=') + 'SCALE_CONFIG='.length))
}

it('keeps full-size fixtures out of the ordinary and native shard inventory', () => {
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
  for (const file of [
    'tests/integration/nativePeerPull.test.ts',
    'tests/integration/nativeIndexedDbResume.test.ts',
    'tests/integration/nativeRepresentationRestart.test.ts',
    'tests/integration/inspectionCacheQuota.test.ts',
  ]) {
    expect(ordinary.test.exclude).toContain(file)
    expect(native.test.exclude).toContain(file)
  }
  const optedIn = optedInProjects()
  expect(optedIn).toHaveLength(3)
  const scale = optedIn[2].test
  expect(scale.name).toBe('scale')
  expect(scale.fileParallelism).toBe(false)
  expect(scale.sequence.groupOrder).toBeGreaterThan(native.test.sequence?.groupOrder ?? 0)
  expect(scale.include).toEqual([
    'tests/integration/nativePeerPull.test.ts',
    'tests/integration/nativeIndexedDbResume.test.ts',
    'tests/integration/nativeRepresentationRestart.test.ts',
    'tests/integration/inspectionCacheQuota.test.ts',
  ])
})

// Exercise Vitest's CLI override and worker scheduler, not just the configuration shape.
it(
  'keeps the native lane serial even when the train requests four workers',
  { timeout: 60_000 },
  () => {
    const projects = optedInProjects()
    expect(projects).toHaveLength(3)
    const directory = mkdtempSync(join(tmpdir(), 'sample-fast-lanes-'))
    const events = join(directory, 'events.jsonl')
    try {
      mkdirSync(join(directory, 'tests/unit'), { recursive: true })
      mkdirSync(join(directory, 'tests/integration'), { recursive: true })
      for (const [kind, folder, names] of [
        ['ordinary', 'unit', ['sampleOne', 'sampleTwo', 'sampleThree', 'sampleFour']],
        ['native', 'integration', ['nativeSampleOne', 'nativeSampleTwo', 'nativeSampleThree']],
        [
          'scale',
          'integration',
          [
            'nativePeerPull',
            'nativeIndexedDbResume',
            'nativeRepresentationRestart',
            'inspectionCacheQuota',
          ],
        ],
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
              projects,
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
      let finishedNative = 0
      for (const row of rows) {
        if (row.kind === 'ordinary' && row.event === 'end') finishedOrdinary++
        if (row.kind === 'native' && row.event === 'end') finishedNative++
        if (row.kind === 'ordinary') continue
        expect(finishedOrdinary).toBe(4)
        if (row.kind === 'scale') expect(finishedNative).toBe(3)
        if (row.event === 'start') {
          expect(active.size).toBe(0)
          active.add(row.name)
        } else expect(active.delete(row.name)).toBe(true)
      }
      expect(active.size).toBe(0)
      expect(rows).toHaveLength(22)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
)
