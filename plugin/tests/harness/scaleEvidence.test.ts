// @vitest-environment node
import { expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { rendererEntries } from '../scale/evidence.mjs'
import {
  readEvidenceJson,
  writeEvidenceJson,
  enableRestartReadEvidence,
} from '../scale/evidence.mjs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { profileSummary } from '../scale/diagnostics.mjs'
import { markdownChunks } from '../scale/oracles.mjs'

it('streams renderer receipts and retains only reads within the restart window', async () => {
  async function* chunks() {
    for (let i = 0; i < 20000; i++)
      yield JSON.stringify({ event: 'content-read-start', at: i, stack: 'x'.repeat(200) }) + '\n'
    yield '{"event":"renderer-start","at":20001}\n{"event":"content-read-'
    yield 'finish","at":20002,"bytes":17}\n{"event":"reindex-complete","at":20003}\n'
  }
  const rows = await rendererEntries(Readable.from(chunks()), 20000)
  expect(rows).toEqual([
    { event: 'renderer-start', at: 20001 },
    { event: 'content-read-finish', at: 20002, bytes: 17 },
    { event: 'reindex-complete', at: 20003 },
  ])
})

it('bounds individual JSON inputs and streams atomic output without whole-object serialization', async () => {
  const root = await mkdtemp(join(process.cwd(), '.scale-evidence-'))
  const path = join(root, 'report.json')
  try {
    await writeFile(path, JSON.stringify({ payload: 'x'.repeat(1000) }))
    await expect(readEvidenceJson(path, 100)).rejects.toThrow('Evidence JSON exceeds')
    const value = {
      rows: Array.from({ length: 10000 }, (_, i) => ({ i, text: 'sample' })),
      missing: undefined,
    }
    await writeEvidenceJson(path, value)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ rows: value.rows })
    const broken = { cyclic: {} }
    broken.cyclic = broken
    await expect(writeEvidenceJson(path, broken)).rejects.toThrow()
    expect(await readEvidenceJson(path)).toEqual({ rows: value.rows })
    await expect(readFile(path + '.next')).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('fails closed on corrupt completed receipts and tolerates only a live partial tail', async () => {
  await expect(rendererEntries(Readable.from(['bad\n{}\n']))).rejects.toThrow()
  await expect(rendererEntries(Readable.from(['{"event":']))).rejects.toThrow()
  expect(await rendererEntries(Readable.from(['{}\n{"event":']), undefined, true)).toEqual([{}])
  await expect(rendererEntries(Readable.from(['bad\n{}\n']), undefined, true)).rejects.toThrow()
  await expect(rendererEntries(Readable.from(['bad\n']), undefined, true)).rejects.toThrow()
})

it('keeps observer errors but excludes pre-restart read volume without a restart', async () => {
  const rows = await rendererEntries(
    Readable.from([
      '{"event":"content-read-start","at":1}\n{"event":"content-read-ready","at":2}\n',
      '{"event":"content-read-error","at":3}\n{"event":"write-start","at":4}\n',
    ])
  )
  expect(rows.map((row) => row.event)).toEqual(['content-read-error', 'write-start'])
})

it('rejects an unbounded single JSONL receipt before concatenating it', async () => {
  await expect(
    rendererEntries(Readable.from(['{"event":"', 'x'.repeat(64), '"}\n']), undefined, false, 32)
  ).rejects.toThrow('Evidence line exceeds')
})

it('bounds concurrent profile loads while analyzing a long recording', async () => {
  let active = 0,
    maximum = 0
  const tasks = Array.from({ length: 8 }, (_, i) => ({
    event: 'long-task',
    device: '0',
    startedAt: i * 100,
    durationMs: 60,
  }))
  const captures = tasks.map((task, i) => ({
    event: 'cpu-profile',
    device: '0',
    startedAt: task.startedAt - 1,
    endedAt: task.startedAt + 61,
    path: String(i),
  }))
  const result = await profileSummary(tasks, captures, async () => {
    maximum = Math.max(maximum, ++active)
    await new Promise((done) => setTimeout(done, 1))
    active--
    return { nodes: [], samples: [] }
  })
  expect(result).toHaveLength(8)
  expect(maximum).toBe(1)
})

it('streams Markdown details even when one restart evidence row contains many reads', () => {
  const chunks = [
    ...markdownChunks({
      budgets: [],
      restartReadEvidence: [
        { reads: Array.from({ length: 10000 }, () => ({ stack: 'sample|frame' })) },
      ],
    }),
  ]
  expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThan(16384)
  expect(chunks.join('')).toContain('sample\\|frame')
})

it('enables strict payload-read observation in every vault before the synced restart', async () => {
  const root = await mkdtemp(join(process.cwd(), '.scale-read-window-'))
  try {
    const vaults = [join(root, 'a'), join(root, 'b')]
    for (const [device, vault] of vaults.entries()) {
      await mkdir(vault)
      await writeEvidenceJson(join(vault, '.scale-observer.json'), {
        observeContentReads: false,
        evidence: 'sample.jsonl',
        device: String(device),
      })
    }
    await enableRestartReadEvidence(vaults)
    for (const [device, vault] of vaults.entries())
      expect(await readEvidenceJson(join(vault, '.scale-observer.json'))).toEqual({
        observeContentReads: true,
        evidence: 'sample.jsonl',
        device: String(device),
      })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
