// @vitest-environment node
import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { classifyReindexHashes } from '../scale/reindex.mjs'
import { profileSummary } from '../scale/diagnostics.mjs'
import * as restart from '../scale/restart.mjs'
import capture from '../scale/receipt-capture.cjs'
import diagnostics from '../scale/diagnostics.cjs'
import { runInNewContext } from 'node:vm'

const sha = 'a'.repeat(64)
const operation = { id: 'sample-rebuild', device: '0', at: 100 }
const digest = {
  device: '0',
  at: 130,
  event: 'renderer-hash',
  source: 'abele',
  sha,
  stack: 'at V2EngineClient.multipart\n at V2EngineClient.putBlobSource',
}
const end = { device: '0', at: 150, event: 'reindex-complete', id: operation.id }

it('separates a proven queued payload digest, including a transfer starting after rebuild', () => {
  const scanned = { ...digest, at: 50, stack: 'at BoundedVaultIo.fingerprint' }
  const queued = {
    id: operation.id,
    event: 'interruption-receipts',
    device: '0',
    complete: true,
    completedAt: 90,
    uploads: [{ sha, path: 'Sample/file.bin' }],
  }
  const wire = [
    {
      device: '0',
      event: 'start',
      at: 120,
      id: 1,
      method: 'PUT',
      sent: 8,
      route: `/v2/uploads/${sha}/sample-upload/0`,
    },
  ]
  const result = classifyReindexHashes(
    operation,
    [scanned, queued, digest, end],
    200,
    new Set([sha]),
    wire
  )
  expect(result.reindexHashes).toEqual([])
  expect(result.queuedUploadDigests).toEqual([digest])
  expect(
    classifyReindexHashes(
      operation,
      [scanned, { ...queued, id: 'older-cut' }, digest, end],
      200,
      new Set([sha]),
      wire
    ).reindexHashes
  ).toEqual([digest])
})

it('still fails new reindex-created scans, unproven payloads and a different device', () => {
  for (const before of [[], [{ ...digest, at: 50, device: '1' }]]) {
    const result = classifyReindexHashes(
      operation,
      [...before, digest, end],
      200,
      new Set([sha]),
      []
    )
    expect(result.reindexHashes).toEqual([digest])
  }
  const scan = { ...digest, stack: 'at Scanner.fingerprint' }
  expect(
    classifyReindexHashes(operation, [scan, end], 200, new Set([sha]), []).reindexHashes
  ).toEqual([scan])
})

it('binds an in-flight upload exemption to its actual session', () => {
  const part = (at: number, session: string) => ({
    event: 'start',
    device: '0',
    at,
    method: 'PUT',
    sent: 8,
    route: `/v2/uploads/${sha}/${session}/0`,
  })
  expect(
    classifyReindexHashes(operation, [digest, end], 200, new Set([sha]), [
      part(80, 'old'),
      part(120, 'old'),
    ]).reindexHashes
  ).toEqual([])
  expect(
    classifyReindexHashes(operation, [digest, end], 200, new Set([sha]), [
      part(80, 'old'),
      part(120, 'new'),
    ]).reindexHashes
  ).toEqual([digest])
})

it('measures strict restart before arming a separate comparison generation', async () => {
  const source = await readFile(new URL('../scale/run.mjs', import.meta.url), 'utf8')
  const strict = source.slice(
    source.indexOf("phase('synced restart')"),
    source.indexOf("phase('post-run heap diagnostics')")
  )
  expect(strict).not.toContain('triggerComparisonAtRestart')
  expect(strict).not.toContain("reindex('reindex-restart-comparison'")
  expect(source).toContain("phase('restart comparison')")
})

it('fails a measured strict window with a hold, a reload or missing generation evidence', () => {
  const entries = [{ event: 'renderer-start', device: '0', at: 101 }]
  expect(restart.strictWindowEvidence(100, 200, '0', entries, []).complete).toBe(true)
  expect(
    restart.strictWindowEvidence(100, 200, '0', entries, [
      { event: 'trigger', device: '0', at: 140 },
    ]).complete
  ).toBe(false)
  expect(
    restart.strictWindowEvidence(100, 200, '0', [...entries, { ...entries[0], at: 160 }], [])
      .complete
  ).toBe(false)
  expect(restart.strictWindowEvidence(100, 200, '0', [], []).complete).toBe(false)
})

it('never treats a receipt-less or identity-proven read-back as exempt recovery', async () => {
  const { classifyRecoveryRead } = await import('../scale/recovery-receipts.mjs')
  const read = {
    device: '1',
    at: 140,
    sha,
    target: 'Sample/file.md',
    stack: 'at PullPlacer.adoptExistingUnlocked',
  }
  const boundary = {
    id: 'sample-cut',
    device: '1',
    at: 100,
    completedAt: 105,
    interruptedAt: 110,
    recoveryEndedAt: 200,
    complete: true,
    targets: [{ target: read.target, sha, pending: true, usableIdentityReceipt: false }],
  }
  expect(classifyRecoveryRead(read, [])).toMatchObject({ status: 'FAIL' })
  expect(classifyRecoveryRead(read, [{ ...boundary, recoveryEndedAt: 130 }]).status).toBe('FAIL')
  expect(classifyRecoveryRead(read, [boundary])).toMatchObject({
    status: 'RECOVERY',
    interruptionId: 'sample-cut',
  })
  expect(
    classifyRecoveryRead(read, [
      boundary,
      { ...boundary, id: 'later-cut', interruptedAt: 130, complete: false },
    ]).status
  ).toBe('FAIL')
  for (const changed of [
    { complete: false },
    { completedAt: 145 },
    { interruptedAt: undefined },
    { interruptedAt: 145 },
    { device: '0' },
    { targets: [{ ...boundary.targets[0], usableIdentityReceipt: true }] },
    { targets: [{ ...boundary.targets[0], pending: false }] },
    { targets: [{ ...boundary.targets[0], target: 'Sample/other.md' }] },
  ])
    expect(classifyRecoveryRead(read, [{ ...boundary, ...changed }])).toMatchObject({
      status: 'FAIL',
    })
})

it('requires exact retained stage linkage and still rejects an ordinary unexplained read', async () => {
  const { classifyRecoveryRead } = await import('../scale/recovery-receipts.mjs')
  const boundary = {
    id: 'sample-cut',
    device: '1',
    at: 100,
    completedAt: 101,
    interruptedAt: 110,
    recoveryEndedAt: 200,
    complete: true,
    targets: [
      {
        target: 'Sample/file.md',
        sha,
        pending: true,
        stage: '.private/sample',
        usableIdentityReceipt: false,
      },
    ],
  }
  const read = {
    device: '1',
    at: 120,
    sha,
    target: 'Sample/file.md',
    stage: '.private/sample',
    stack: 'at nativeInstallBatch',
  }
  expect(classifyRecoveryRead(read, [boundary]).status).toBe('RECOVERY')
  expect(classifyRecoveryRead({ ...read, stage: '.private/other' }, [boundary]).status).toBe('FAIL')
  expect(
    classifyRecoveryRead({ ...read, stack: 'at Scanner.fingerprint' }, [boundary]).status
  ).toBe('FAIL')
})

it('acknowledges profiling before product evaluation and preserves unknown task failure', async () => {
  const { enableAfterProfile } = await import('../scale/profile-gate.cjs')
  const calls: string[] = []
  let acknowledge!: () => void
  const ready = new Promise<void>((resolve) => {
    acknowledge = resolve
  })
  const enabled = enableAfterProfile(ready, () => {
    calls.push('evaluate')
  })
  expect(calls).toEqual([])
  acknowledge()
  await enabled
  expect(calls).toEqual(['evaluate'])
  await expect(
    enableAfterProfile(Promise.reject(new Error('profile failed')), () => calls.push('bad'))
  ).rejects.toThrow('profile failed')
  const tasks = await profileSummary(
    [{ event: 'long-task', device: '0', startedAt: 1, durationMs: 100 }],
    [],
    async () => null
  )
  expect(tasks[0]).toMatchObject({ source: 'unknown', attributionPass: false })
})

it('does not accept a short profile tail as coverage of a long claimed receipt window', async () => {
  const result = await profileSummary(
    [{ event: 'long-task', device: '0', startedAt: 100, durationMs: 637 }],
    [
      {
        event: 'cpu-profile',
        device: '0',
        startedAt: 0,
        endedAt: 33000,
        path: 'sample',
        continuous: true,
        clock: { beforeAt: 0, afterAt: 0, timestampMs: 0 },
      },
    ],
    async () => ({
      startTime: 32844000,
      endTime: 33000000,
      nodes: [{ id: 1, callFrame: { functionName: 'sample', url: 'plugin:abele' } }],
      samples: [1],
      timeDeltas: [156000],
    })
  )
  expect(result[0]).toMatchObject({
    attributionPass: false,
    profileWindowComplete: false,
    source: 'unknown',
  })
})

it('keeps profiler readiness false until start acknowledgement and after startup failure', async () => {
  let acknowledge!: () => void
  const ack = new Promise<void>((resolve) => {
    acknowledge = resolve
  })
  const profiler = diagnostics.createStallProfiler({
    continuous: true,
    command: async () => ack,
    save: async () => 'sample',
    emit: () => {},
  })
  profiler.heartbeat(0)
  const starting = profiler.poll(1)
  expect(profiler.running()).toBe(false)
  acknowledge()
  await starting
  expect(profiler.running()).toBe(true)
  await profiler.close(2)
  const failed = diagnostics.createStallProfiler({
    continuous: true,
    command: async () => {
      throw new Error('sample failure')
    },
    save: async () => '',
    emit: () => {},
  })
  failed.heartbeat(0)
  await failed.poll(1)
  expect(failed.running()).toBe(false)
})

it('exports the previous capture and acknowledges a fresh profile before each reload evaluation', async () => {
  const calls: string[] = []
  const profiler = diagnostics.createStallProfiler({
    continuous: true,
    command: async (name: string) => {
      calls.push(name)
      return { profile: { nodes: [], samples: [] } }
    },
    save: async () => {
      calls.push('save')
      return 'sample-profile'
    },
    emit: () => {},
  })
  profiler.heartbeat(0)
  await profiler.poll(1)
  await profiler.restart(2)
  expect(calls).toEqual(['Profiler.start', 'Profiler.stop', 'save', 'Profiler.start'])
  expect(profiler.running()).toBe(true)
  await profiler.close(3)
})

it('exports pending and acknowledged intent outcomes without unrelated metadata', async () => {
  const pending = {
    target: 'Sample/file.md',
    fileId: 'file-1',
    versionId: 'version-2',
    sha,
    token: 'fake-secret-do-not-export',
  }
  const tx = {
    metadataKeys: async () => ['pull-write:file-1'],
    getMeta: async (key: string) =>
      key.startsWith('pull-write:') ? JSON.stringify(pending) : null,
    byFileId: async () => ({ versionId: 'version-1', sha }),
  }
  let committed = false
  const runtime = {
    options: {
      fs: { pathKey: (path: string) => path },
      state: {
        ...tx,
        transaction: async (work: (value: typeof tx) => unknown) => {
          const result = await work(tx)
          committed = true
          return result
        },
      },
    },
  }
  const result = await capture.captureRuntime(runtime, { scanInstallation: () => undefined })
  expect(committed).toBe(true)
  expect(result.targets).toMatchObject([{ pending: true, usableIdentityReceipt: false }])
  expect(JSON.stringify(result)).not.toContain(pending.token)
  tx.byFileId = async () => ({ versionId: 'version-2', sha })
  expect(
    (
      await capture.captureRuntime(runtime, {
        scanInstallation: () => ({ identity: 'sample-object' }),
      })
    ).targets
  ).toMatchObject([{ pending: false, usableIdentityReceipt: true }])
})

it('installs diagnostic access before onload without copying unrelated product state', () => {
  const calls: string[] = []
  const context = { __scaleWrapFingerprints: (value: { name: string }) => calls.push(value.name) }
  const source =
    'function storageOf(app) { return app }\nconst durableHostOf = app => app.host;\nclass BoundedVaultIo {}'
  runInNewContext(capture.instrumentReceiptAccess(source), context)
  expect(context.__scaleReceiptHost({ host: 'sample-host' })).toBe('sample-host')
  expect(calls).toEqual(['BoundedVaultIo'])
  expect(() => capture.instrumentReceiptAccess('module.exports = {}')).toThrow(
    'binding unavailable'
  )
})

it('reads only committed private-stage rows in the current host namespace and owner', async () => {
  const rows = [
    {
      namespace: 'sample-vault',
      key: 'abele-sync-writes',
      id: 'one',
      value: {
        owner: 'sample-connection',
        target: 'Sample/file.md',
        temp: '.private/sample',
        replacementSha: sha,
        disposableSource: true,
        streaming: { base: null },
      },
    },
    {
      namespace: 'another-vault',
      key: 'abele-sync-writes',
      id: 'two',
      value: { secret: 'fake-private-value' },
    },
  ]
  const host = {
    namespace: 'sample-vault',
    scanInstallation: () => undefined,
    db: {
      transaction: (_names: string[], mode: string) => {
        expect(mode).toBe('readonly')
        const tx: any = {}
        tx.objectStore = () => ({
          openCursor: () => {
            const request: any = {}
            let index = 0
            const step = () => {
              request.result =
                index < rows.length
                  ? {
                      value: rows[index],
                      continue: () => {
                        index++
                        queueMicrotask(step)
                      },
                    }
                  : null
              request.onsuccess()
              if (!request.result) queueMicrotask(() => tx.oncomplete())
            }
            queueMicrotask(step)
            return request
          },
        })
        return tx
      },
    },
  }
  const state = { get: async () => null }
  const result = await capture.captureHostStages(
    host,
    state,
    'sample-connection',
    (path: string) => path
  )
  expect(result).toMatchObject([
    {
      target: 'Sample/file.md',
      stage: '.private/sample',
      pending: true,
      usableIdentityReceipt: false,
    },
  ])
  expect(JSON.stringify(result)).not.toContain('fake-private-value')
  expect(
    await capture.captureHostStages(host, state, 'other-connection', (path: string) => path)
  ).toEqual([])
})

it('records a failed snapshot as unknown without persisting the thrown private message', async () => {
  const saved = globalThis.__scaleReceiptHost
  globalThis.__scaleReceiptHost = () => ({ scanInstallation() {} })
  const emitted: unknown[] = []
  try {
    const runtime = {
      options: {
        fs: { pathKey: (path: string) => path },
        state: {
          metadataKeys() {},
          transaction: () => {
            throw new Error('fake-token-do-not-persist')
          },
        },
      },
    }
    const result = await capture.captureBoundary({
      id: 'sample-cut',
      device: '1',
      app: {
        plugins: { plugins: { abele: { tokenEngines: { live: new Map([['one', runtime]]) } } } },
      },
      emit: (value: unknown) => emitted.push(value),
      now: () => 10,
    })
    expect(result.complete).toBe(false)
    expect(emitted).toHaveLength(1)
    expect(JSON.stringify(emitted)).not.toContain('fake-token-do-not-persist')
  } finally {
    globalThis.__scaleReceiptHost = saved
  }
})
