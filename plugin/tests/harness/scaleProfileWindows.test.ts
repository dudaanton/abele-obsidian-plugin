// @vitest-environment node
import { expect, it } from 'vitest'
import { analyzeWindows, summarizeProfile } from '../scale/profile-windows.mjs'

it('clips calibrated sample intervals and resolves omitted URLs by script identity', () => {
  const profile = {
    startTime: 500000,
    endTime: 530000,
    nodes: [
      { id: 1, callFrame: { functionName: '(root)', scriptId: '0', url: '' }, children: [2] },
      {
        id: 2,
        callFrame: { functionName: 'scan', scriptId: '7', url: 'plugin:abele', lineNumber: 10 },
        children: [3],
      },
      { id: 3, callFrame: { functionName: 'clone', scriptId: '7', url: '', lineNumber: 20 } },
    ],
    samples: [3, 3, 3],
    timeDeltas: [10000, 10000, 10000],
  }
  const result = summarizeProfile(
    profile,
    { device: '0', clock: { beforeAt: 1000, afterAt: 1002, timestampMs: 500 } },
    { start: 1005, end: 1025 }
  )
  expect(result.sampledMs).toBe(20)
  expect(result.categories.plugin).toBe(20)
  expect(result.functions.clone).toMatchObject({ selfMs: 20, totalMs: 20 })
  expect(result.functions.scan).toMatchObject({ selfMs: 0, totalMs: 20 })
  expect(result.clockUncertaintyMs).toBe(2)
})

it('counts a recursive function only once per inclusive sample and keeps native leaf time separate', () => {
  const profile = {
    startTime: 0,
    nodes: [
      {
        id: 1,
        callFrame: { functionName: 'scan', scriptId: '7', url: 'plugin:abele' },
        children: [2],
      },
      { id: 2, callFrame: { functionName: 'scan', scriptId: '7', url: '' }, children: [3] },
      { id: 3, callFrame: { functionName: 'lstat', scriptId: '0', url: '' } },
    ],
    samples: [3],
    timeDeltas: [10000],
  }
  const result = summarizeProfile(
    profile,
    { device: '1', clock: { beforeAt: 100, afterAt: 100, timestampMs: 0 } },
    { start: 100, end: 110 }
  )
  expect(result.functions.scan).toMatchObject({ selfMs: 0, totalMs: 10 })
  expect(result.categories.native).toBe(10)
  expect(result.leafOwners['plugin:lstat']).toBe(10)
  expect(result.functions.lstat).toBeUndefined()
})

it('rejects uncalibrated or malformed sample timing instead of inventing coverage', () => {
  expect(() =>
    summarizeProfile({ nodes: [], samples: [], timeDeltas: [] }, {}, { start: 0, end: 1 })
  ).toThrow('calibrated')
  expect(() =>
    summarizeProfile(
      { startTime: 0, nodes: [], samples: [1], timeDeltas: [-1] },
      { clock: { beforeAt: 0, afterAt: 0, timestampMs: 0 } },
      { start: 0, end: 1 }
    )
  ).toThrow('sample timing')
})

it('selects the calibrated profile span when acknowledgement receipts describe a different span', async () => {
  const result = await analyzeWindows(
    [
      {
        path: 'sample.cpuprofile',
        device: '0',
        startedAt: 5000,
        endedAt: 6000,
        clock: { beforeAt: 100, afterAt: 100, timestampMs: 0 },
      },
    ],
    '.',
    [{ name: 'sample', device: '0', start: 100, end: 110 }],
    async () => ({
      startTime: 0,
      endTime: 10000,
      nodes: [{ id: 1, callFrame: { functionName: 'scan', scriptId: '7', url: 'plugin:abele' } }],
      samples: [1],
      timeDeltas: [10000],
    })
  )
  expect(result[0].sampledMs).toBe(10)
})
