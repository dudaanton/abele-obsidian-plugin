// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { requireHealthySnapshot } from '../scale/progress.mjs'
import {
  phaseTimings,
  saveCheckpoint,
  requireTime,
  activeRequestIds,
  recoveryTimings,
  requireServerCapacity,
  saveFailureCheckpoint,
  uploadRecoveryMetrics,
  fatalDeviceSnapshots,
} from '../scale/progress.mjs'

it('carries the first fatal snapshot without requiring a second state read', () => {
  const snapshot = { rows: [{ status: 'error' }] }
  let failure: unknown
  try {
    requireHealthySnapshot(snapshot)
  } catch (error) {
    failure = error
  }
  expect(failure).toMatchObject({ scaleFatalSnapshot: snapshot })
})

it('retains the triggering fatal device after a later snapshot returns to syncing', () => {
  const fatal = { rows: [{ status: 'error' }], engines: [{ lastError: 'sample failure' }] }
  expect(
    fatalDeviceSnapshots(
      [{ rows: [{ status: 'idle' }] }, { rows: [{ status: 'syncing' }] }],
      [{ device: '1', snapshot: fatal }]
    )
  ).toEqual([{ device: 1, snapshot: fatal }])
})

it('captures current errors once and ignores nonfatal or unbound retained snapshots', () => {
  const fatal = { rows: [{ status: 'error' }] }
  expect(
    fatalDeviceSnapshots(
      [fatal, { rows: [{ status: 'syncing' }] }],
      [
        { device: '0', snapshot: fatal },
        { device: '1', snapshot: { rows: [{ status: 'syncing' }] } },
        { device: '9', snapshot: fatal },
        { snapshot: fatal },
      ]
    )
  ).toEqual([{ device: 0, snapshot: fatal }])
  expect(
    fatalDeviceSnapshots(
      [{ rows: [{ status: 'idle' }] }],
      [
        { device: null, snapshot: fatal },
        { device: '', snapshot: fatal },
      ]
    )
  ).toEqual([])
})

it('separates recovery presence probes, upload admission and actual payload bytes', () => {
  const events = [
    {
      device: '0',
      event: 'start',
      id: 0,
      at: 90,
      method: 'PUT',
      route: '/v2/uploads/old',
      sent: 10,
    },
    { device: '0', event: 'start', id: 1, at: 110, method: 'GET', route: '/v2/connection' },
    { device: '0', event: 'start', id: 2, at: 120, method: 'HEAD', route: '/v2/uploads/sample' },
    { device: '0', event: 'finish', id: 2, at: 123, status: 200 },
    { device: '0', event: 'start', id: 3, at: 125, method: 'HEAD', route: '/v2/uploads/new' },
    { device: '0', event: 'finish', id: 3, at: 126, status: 404 },
    {
      device: '1',
      event: 'start',
      id: 4,
      at: 127,
      method: 'PUT',
      route: '/v2/uploads/peer',
      sent: 4,
    },
    { device: '0', event: 'start', id: 5, at: 130, method: 'POST', route: '/v2/uploads/new/begin' },
    { device: '0', event: 'start', id: 6, at: 135, method: 'HEAD', route: '/v2/uploads/later' },
    {
      device: '0',
      event: 'start',
      id: 7,
      at: 140,
      method: 'PUT',
      route: '/v2/uploads/new/part/0',
      sent: 4,
    },
    {
      device: '0',
      event: 'start',
      id: 8,
      at: 160,
      method: 'HEAD',
      route: '/v2/uploads/next-phase',
    },
  ]
  expect(uploadRecoveryMetrics(events, 100, { untilAt: 150 })).toEqual({
    observed: true,
    firstRequestMs: 10,
    firstUploadMs: 30,
    firstPayloadPutMs: 40,
    headRequestsSeen: 3,
    headRequestsBeforeUpload: 2,
    headStatusesBeforeUpload: { present: 1, absent: 1, other: 0, incomplete: 0 },
  })
})

it('keeps missing recovery and untransmitted payload measurements unknown', () => {
  expect(uploadRecoveryMetrics([], undefined)).toMatchObject({
    observed: false,
    firstUploadMs: null,
    firstPayloadPutMs: null,
    headRequestsSeen: null,
  })
  expect(
    uploadRecoveryMetrics(
      [
        {
          device: '0',
          event: 'start',
          id: 1,
          at: 110,
          method: 'PUT',
          route: '/v2/uploads/sample',
          declaredBytes: 42,
        },
      ],
      100
    )
  ).toMatchObject({ firstUploadMs: 10, firstPayloadPutMs: null })
})

it('stops on fatal sync state while retaining its diagnostic snapshot', () => {
  const snapshot = { rows: [{ status: 'error' }], engines: [{ lastError: 'invalid path' }] }
  expect(() => requireHealthySnapshot(snapshot)).toThrow('Fatal sync state')
  expect(snapshot.engines[0].lastError).toBe('invalid path')
  expect(() => requireHealthySnapshot({ rows: [{ status: 'idle' }] })).not.toThrow()
  expect(() => requireHealthySnapshot(null)).not.toThrow()
})

it('persists the failed phase and explicitly marks remaining evidence unrun', async () => {
  const root = await mkdtemp(join(process.cwd(), '.scale-failure-'))
  try {
    const report = {
      phase: 'second device pull',
      phases: [{ name: 'second device pull', at: 100 }],
      interruptions: [],
      failure: 'Harness operation failed',
    }
    await saveFailureCheckpoint(
      root,
      report,
      [{ events: [{ event: 'start', at: 120 }] }],
      'scenario',
      130
    )
    const checkpoint = JSON.parse(await readFile(join(root, 'checkpoint.json'), 'utf8'))
    expect(checkpoint.harnessFailures).toEqual([
      { stage: 'scenario', phase: 'second device pull', at: 130 },
    ])
    expect(checkpoint.remainingPhaseEvidence).toContainEqual({
      phase: 'synced restart',
      status: 'not run',
    })
    expect(checkpoint.wire).toEqual([{ event: 'start', at: 120 }])
    expect(report.phase).toBe('second device pull')
    const status = JSON.parse(await readFile(join(root, 'phase-status.json'), 'utf8'))
    expect(status.harnessFailures).toEqual(checkpoint.harnessFailures)
    expect(status.remainingPhaseEvidence).toEqual(checkpoint.remainingPhaseEvidence)
    expect(status.wire).toBeUndefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects an undersized server without excluding or trimming the required files', () => {
  const plan = [{ path: 'Attachments/sample.pdf', size: 256 * 1024 ** 2 }]
  expect(() =>
    requireServerCapacity(plan, { max_file_bytes: 200 * 1024 ** 2, quota_bytes: null })
  ).toThrow('Server file limit 209715200 is below required 268435456')
  expect(
    requireServerCapacity(plan, { max_file_bytes: 256 * 1024 ** 2, quota_bytes: null })
  ).toMatchObject({ requiredFileBytes: 268435456, serverFileBytes: 268435456 })
  expect(plan).toEqual([{ path: 'Attachments/sample.pdf', size: 268435456 }])
})

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

it('retains immutable phase-boundary evidence as newer checkpoints advance', async () => {
  const root = await mkdtemp(join(process.cwd(), '.scale-phase-'))
  try {
    const upload = {
      phase: 'upload',
      phases: [{ name: 'upload', at: 100 }],
      interruptions: [],
      verificationComplete: false,
    }
    await saveCheckpoint(root, upload, [], 100, true)
    await saveCheckpoint(
      root,
      { ...upload, phase: 'pull', phases: [...upload.phases, { name: 'pull', at: 200 }] },
      [],
      200,
      true
    )
    const first = JSON.parse(await readFile(join(root, 'phases/100-1-0.json'), 'utf8'))
    expect(first.phase).toBe('upload')
    expect(first.verificationComplete).toBe(false)
    expect(JSON.parse(await readFile(join(root, 'checkpoint.json'), 'utf8')).phase).toBe('pull')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
