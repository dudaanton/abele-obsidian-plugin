// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { parseProcessTimeline, schedulingEvidence, startHostTimeline } from './host-timeline.mjs'

it('records CPU/state identity without command lines or paths', () => {
  expect(parseProcessTimeline(' 12 1 S 00:01.25\n 13 12 T 01:02.50\n', 12))
    .toEqual([{ pid: 12, parentPid: 1, state: 'S', cpuMs: 1250 },
      { pid: 13, parentPid: 12, state: 'T', cpuMs: 62500 }])
})
it('exports outside-renderer samples and drains the sampler on stop without persisting exec errors', async () => {
  const root = await mkdtemp(join(process.cwd(), '.timeline-test-'))
  try {
    const file = join(root, 'timeline.jsonl')
    let calls = 0
    const stop = startHostTimeline(12, file, { intervalMs: 5,
      execute: async () => {
        if (!calls++) return { stdout: '12 1 S 00:01.25' }
        throw new Error('sample-secret-in-private-argv')
      } })
    await new Promise(resolve => setTimeout(resolve, 25))
    await stop()
    const text = await readFile(file, 'utf8')
    expect(text).not.toContain('sample-secret')
    const rows = text.trim().split('\n').map(line => JSON.parse(line))
    expect(rows[0]).toMatchObject({ event: 'host-process-sample',
      at: expect.any(Number), monotonicMs: expect.any(Number), load: expect.any(Array),
      processes: [{ pid: 12, parentPid: 1, state: 'S', cpuMs: 1250 }] })
    expect(rows.find(row => row.unavailable)).toMatchObject({
      event: 'host-process-sample', unavailable: true, category: 'process-sample-unavailable' })
    await new Promise(resolve => setTimeout(resolve, 15))
    expect(await readFile(file, 'utf8')).toBe(text)
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('reports explicit externally stopped processes separately from an unproved sampling gap', () => {
  const task = { startedAt: 1000, durationMs: 1000 }
  const rows = [900, 1100, 1300, 1500, 1700, 1900, 2100].map(at => ({ at,
    processes: [{ pid: 12, parentPid: 1, state: 'T', cpuMs: 20 },
      { pid: 13, parentPid: 12, state: 'T', cpuMs: 30 }] }))
  expect(schedulingEvidence(task, rows).reason).toBe('shared-observed-process-stop')
  expect(schedulingEvidence(task, rows.map(r => ({ ...r, processes: r.processes.map(p => ({ ...p, state: 'S' })) }))).reason)
    .toBe('no-proven-process-stop')
  expect(schedulingEvidence(task, [rows[0], rows.at(-1)!]).reason).toBe('external-timeline-gap')
})
