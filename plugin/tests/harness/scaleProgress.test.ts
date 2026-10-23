// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  phaseTimings,
  saveCheckpoint,
  requireTime,
  activeRequestIds,
  recoveryTimings,
} from '../scale/progress.mjs'

it('keeps recovery observations within their interruption and does not invent an idle observation', () => {
  const interruptions = [
    { kind: 'network drop', at: 100 },
    { kind: 'pause mid-pull', at: 200 },
  ]
  const wire = [
    { device: '0', event: 'start', id: 1, at: 110 },
    { device: '0', event: 'finish', id: 1, at: 130, status: 200 },
    { device: '1', event: 'start', id: 1, at: 210 },
  ]
  expect(recoveryTimings(interruptions, wire, [])).toEqual([
    {
      kind: 'network drop',
      at: 100,
      device: '0',
      firstRequestMs: 10,
      firstSuccessfulResponseMs: 30,
      idleMs: null,
    },
    {
      kind: 'pause mid-pull',
      at: 200,
      device: '1',
      firstRequestMs: 10,
      firstSuccessfulResponseMs: null,
      idleMs: null,
    },
  ])
})

it('reconstructs in-flight requests at the real pause invocation rather than before CLI latency', () => {
  const events = [
    { event: 'start', id: 1, at: 90 },
    { event: 'start', id: 2, at: 95 },
    { event: 'close', id: 1, at: 99 },
    { event: 'start', id: 3, at: 105 },
    { event: 'finish', id: 2, at: 110 },
  ]
  expect([...activeRequestIds(events, 100)]).toEqual([2])
})

it('retains finished and ongoing phase durations without calling a partial run complete', async () => {
  const phases = [
    { name: 'upload', at: 100 },
    { name: 'pull', at: 400 },
  ]
  expect(phaseTimings(phases, 550)).toEqual([
    { name: 'upload', at: 100, durationMs: 300, ongoing: false },
    { name: 'pull', at: 400, durationMs: 150, ongoing: true },
  ])
  const root = await mkdtemp(join(process.cwd(), '.scale-progress-'))
  try {
    await saveCheckpoint(
      root,
      { phase: 'pull', phases, verificationComplete: false },
      [{ events: [{ at: 450, event: 'start' }] }],
      550
    )
    const checkpoint = JSON.parse(await readFile(join(root, 'checkpoint.json'), 'utf8'))
    expect(checkpoint.verificationComplete).toBe(false)
    expect(checkpoint.checkpointAt).toBe(550)
    expect(checkpoint.phaseTimings[1].ongoing).toBe(true)
    expect(checkpoint.wire).toEqual([{ at: 450, event: 'start' }])
    expect(JSON.parse(await readFile(join(root, 'checkpoint.json'), 'utf8'))).toEqual(checkpoint)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('stops exactly at the deadline and permits only time strictly before it', () => {
  expect(() => requireTime(1000, 999)).not.toThrow()
  expect(() => requireTime(1000, 1000)).toThrow('Run deadline reached')
  expect(() => requireTime(1000, 1001)).toThrow('Run deadline reached')
})
