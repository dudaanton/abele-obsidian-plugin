// @vitest-environment node
import { describe, expect, it } from 'vitest'
import fastConfig from '../../vitest.config'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  makePlan,
  mergeInventories,
  selectShard,
  durationsFromReport,
} from '../../scripts/fast-shards.mjs'

const files = [
  'tests/unit/sample-a.test.ts',
  'tests/unit/sample-b.test.ts',
  'tests/unit/sample-c.test.ts',
  'tests/unit/sample-d.test.ts',
]
const plan = () =>
  makePlan(
    files,
    { [files[0]]: 9000, [files[1]]: 7000, [files[2]]: 2000, [files[3]]: 1000 },
    2,
    'sample-inputs'
  )
const parts = (p: any) =>
  p.shards.map((shard: any, i: number) => ({
    index: i + 1,
    planDigest: p.digest,
    identity: p.identity,
    rc: 0,
    inventory: {
      expected: shard.files,
      unhandled_errors: 0,
      files: shard.files.map((file: string) => ({
        file,
        status: 'passed',
        tests: [{ name: 'sample case', status: 'passed' }],
      })),
    },
  }))

describe('duration-balanced fast shards', () => {
  it('bounds workers explicitly while preserving per-file isolation', () => {
    expect(fastConfig.test?.maxWorkers).toBe(process.env.ABELE_FAST_SHARD_PLAN ? 4 : 3)
    expect(fastConfig.test?.isolate).not.toBe(false)
  })

  it('balances long files deterministically and assigns every expected file once', () => {
    const p = plan()
    expect(p.shards.map((s: any) => s.durationMs)).toEqual([10000, 9000])
    expect(p.shards.flatMap((s: any) => s.files).sort()).toEqual(files)
    expect(
      makePlan(
        [...files].reverse(),
        { [files[0]]: 9000, [files[1]]: 7000, [files[2]]: 2000, [files[3]]: 1000 },
        2,
        'sample-inputs'
      )
    ).toEqual(p)
    expect(selectShard(p, files, 1, 2)).toEqual(p.shards[0].files)
  })

  it('keeps a sealed plan valid when a coordinator reorders JSON object keys', () => {
    const p = plan()
    const encoded = JSON.parse(
      JSON.stringify(p, [
        'digest',
        'durationMs',
        'expected',
        'files',
        'identity',
        'schema',
        'shards',
      ])
    )
    expect(selectShard(encoded, files, 1, 2)).toEqual(p.shards[0].files)
    expect(mergeInventories(encoded, parts(p)).expected).toEqual(files)
  })

  it('rejects empty, duplicate, escaping, unknown and changed inventories', () => {
    for (const expected of [[], [files[0], files[0]], ['../sample.test.ts'], ['/sample.test.ts']])
      expect(() => makePlan(expected, {}, 2, 'sample-inputs')).toThrow()
    expect(() => makePlan(files, {}, 5, 'sample-inputs')).toThrow()
    expect(() => selectShard(plan(), files.slice(1), 1, 2)).toThrow()
    expect(() => selectShard(plan(), files, 0, 2)).toThrow()
    expect(() => selectShard(plan(), files, 1, 3)).toThrow()
    const p = plan()
    p.shards[0].files.push(files[1])
    expect(() => selectShard(p, files, 1, 2)).toThrow()
  })

  it('uses a bounded startup weight and a conservative fallback for unseen files', () => {
    const p = makePlan(files, { [files[0]]: 0 }, 2, 'sample-inputs')
    expect(p.shards.map((s: any) => s.durationMs)).toEqual([800, 800])
    expect(
      durationsFromReport(
        { testResults: [{ name: '/sample/plugin/' + files[0], startTime: 10, endTime: 110 }] },
        '/sample/plugin'
      )
    ).toEqual({ [files[0]]: 100 })
  })

  it('drives the actual Vitest shard sequencer without duplicate or omitted modules', () => {
    const selected = ['tests/unit/sample-a.test.ts', 'tests/unit/sample-b.test.ts']
    const p = makePlan(selected, {}, 2, 'sample-inputs')
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'sample-shards-')))
    mkdirSync(join(directory, 'tests/unit'), { recursive: true })
    for (const file of selected)
      writeFileSync(join(directory, file), 'test("sample case", () => expect(1).toBe(1))')
    const config = join(directory, 'vitest.config.mjs')
    writeFileSync(
      config,
      `import FastSequencer from ${JSON.stringify(new URL('../../scripts/fast-sequencer.mjs', import.meta.url).href)}; export default { test: { globals: true, environment: 'node', include: ['tests/unit/**/*.test.ts'], sequence: { sequencer: FastSequencer } } }`
    )
    const command = [
      resolve('node_modules/vitest/vitest.mjs'),
      'run',
      `--config=${config}`,
      `--root=${directory}`,
      '--maxWorkers=2',
    ]
    const manifest = join(directory, 'plan.json')
    writeFileSync(manifest, JSON.stringify(p))
    try {
      for (const index of [1, 2]) {
        const output = join(directory, `shard-${index}.json`)
        // Vitest list deliberately ignores --shard; run two small suites to exercise sequencing.
        execFileSync(
          process.execPath,
          [...command, '--reporter=json', `--outputFile=${output}`, `--shard=${index}/2`],
          {
            env: { ...process.env, ABELE_FAST_SHARD_PLAN: manifest },
            stdio: 'pipe',
          }
        )
        const report = JSON.parse(readFileSync(output, 'utf8'))
        expect(
          report.testResults.every((entry: any) => entry.name.startsWith(directory + '/'))
        ).toBe(true)
        const collected = report.testResults.map((entry: any) =>
          entry.name.replace(directory + '/', '')
        )
        expect(collected.sort()).toEqual(p.shards[index - 1].files)
      }
      expect(() =>
        execFileSync(process.execPath, command, {
          env: { ...process.env, ABELE_FAST_SHARD_PLAN: manifest },
          stdio: 'pipe',
        })
      ).toThrow()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('merges only complete successful same-input shard inventories', () => {
    const p = plan()
    const merged = mergeInventories(p, parts(p))
    expect(merged.expected).toEqual(files)
    expect(merged.files.map((f: any) => f.file)).toEqual(files)
    expect(merged.unhandled_errors).toBe(0)
    expect(() => mergeInventories(p, parts(p).slice(0, 1))).toThrow()
    expect(() => mergeInventories(p, [parts(p)[0], parts(p)[0]])).toThrow()
    for (const change of [
      (x: any) => {
        x.rc = 1
      },
      (x: any) => {
        x.identity = 'other-inputs'
      },
      (x: any) => {
        x.planDigest = 'other-plan'
      },
      (x: any) => {
        x.inventory.unhandled_errors = 1
      },
      (x: any) => {
        x.inventory.files.pop()
      },
      (x: any) => {
        x.inventory.files[0].tests[0].status = 'failed'
      },
      (x: any) => {
        x.inventory.files[0].tests = []
      },
    ]) {
      const incomplete = parts(p)
      change(incomplete[0])
      expect(() => mergeInventories(p, incomplete)).toThrow()
    }
  })
})
