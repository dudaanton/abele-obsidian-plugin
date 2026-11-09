import { expect, it, vi } from 'vitest'
import {
  EngineError,
  MemoryFileSystem,
  MemoryStateStore,
  SyncEngine,
  sha256,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { selectiveFrom } from '@/sync/connection'

it('yields while classifying a large additive replay journal', async () => {
  const { refreshLocalPaths } = await import(
    '../../node_modules/@abele/sync-sdk/dist/internal/core/localPaths.js'
  )
  const state = new MemoryStateStore()
  let visits = 0,
    longest = 0
  state.getJournal = async () => ({
    batchId: 'sample-batch',
    idempotencyKey: 'sample-request',
    startedAt: new Date().toISOString(),
    ops: Array.from({ length: 1024 }, () => ({
      get op() {
        longest = Math.max(longest, ++visits)
        return 'create' as const
      },
      path: 'sample.md',
      sha: 'a'.repeat(64),
      size: 1,
      mtime: 1,
    })),
  })
  await refreshLocalPaths(
    Object.assign(new MemoryFileSystem(), { listChildren: async () => [] }),
    state,
    {
      yieldTask: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        visits = 0
      },
    }
  )
  expect(longest).toBeGreaterThan(0)
  expect(longest).toBeLessThanOrEqual(64)
})

it('resumes a named upload before enumerating 33000 unrelated files', async () => {
  const fs = new MemoryFileSystem(),
    state = new MemoryStateStore()
  const path = 'Attachments/sample.bin',
    bytes = new Uint8Array([1, 2, 3])
  const sha = await sha256(bytes)
  await fs.writeAtomic(path, bytes, 1000)
  await state.setCursor(1)
  await state.setJournal({
    batchId: 'sample-batch',
    idempotencyKey: 'sample-request',
    startedAt: new Date().toISOString(),
    ops: [{ op: 'create', path, sha, size: bytes.length, mtime: 1000 }],
  })
  Object.assign(fs, {
    listChildren: async (parent: string) =>
      parent === ''
        ? [{ path: 'Attachments', kind: 'directory', identity: 'folder' }]
        : parent === 'Attachments'
          ? [{ path, kind: 'file' }]
          : [],
  })
  const list = vi.spyOn(fs, 'list').mockImplementation(async function* () {
    console.debug('replay inventory caller', new Error().stack)
    for (let i = 0; i < 33000; i++) yield { path: `Notes/层/Sample ${i}.md`, size: 1, mtime: 1000 }
    yield { path, size: bytes.length, mtime: 1000 }
  })
  const upload = vi.fn(async () => {
    throw new EngineError('offline', 'sample upload interruption')
  })
  const client = {
    state: async () => ({ head_seq: 1, settings: { max_file_bytes: 1e9, quota_bytes: null } }),
    hasBlob: async () => false,
    putBlob: upload,
  } as unknown as EngineClient
  const engine = new SyncEngine({ fs, state, client, selective: selectiveFrom(undefined) })
  try {
    await engine.sync().catch(() => {})
    expect(upload).toHaveBeenCalledOnce()
    expect(list).not.toHaveBeenCalled()
    expect(await state.getJournal()).not.toBeNull()
  } finally {
    await engine.stop()
  }
})

it('keeps unrelated directory holds during focused replay refresh', async () => {
  const { refreshLocalPaths } = await import(
    '../../node_modules/@abele/sync-sdk/dist/internal/core/localPaths.js'
  )
  const fs = Object.assign(new MemoryFileSystem(), { listChildren: async () => [] })
  const state = new MemoryStateStore()
  const holds = JSON.stringify([
    { path: 'Other/é', winner: 'Other/é', aliases: ['Other/é', 'Other/é'] },
  ])
  await state.setMeta('normalization-directory-collisions', holds)
  await state.setJournal({
    batchId: 'sample',
    idempotencyKey: 'sample',
    startedAt: new Date().toISOString(),
    ops: [{ op: 'create', path: 'sample.md', sha: 'a'.repeat(64), size: 1, mtime: 1 }],
  })
  await refreshLocalPaths(fs, state)
  expect(await state.getMeta('normalization-directory-collisions')).toBe(holds)
})

it('still refuses a canonically ambiguous journal source without a whole-vault scan', async () => {
  const { sourcesFromOps } = await import(
    '../../node_modules/@abele/sync-sdk/dist/internal/core/pushSources.js'
  )
  const fs = new MemoryFileSystem(),
    state = new MemoryStateStore()
  const bytes = new Uint8Array([1]),
    sha = await sha256(bytes)
  await fs.writeAtomic('é/sample.bin', bytes, 1)
  await fs.writeAtomic('é/sample.bin', new Uint8Array([2]), 1)
  Object.assign(fs, {
    listChildren: async (parent: string) =>
      parent === ''
        ? [
            { path: 'é', kind: 'directory', identity: 'first' },
            { path: 'é', kind: 'directory', identity: 'second' },
          ]
        : [],
  })
  const list = vi.spyOn(fs, 'list')
  const sources = await sourcesFromOps(fs, state, [
    { op: 'create', path: 'é/sample.bin', sha, size: 1, mtime: 1 },
  ])
  await expect(sources.bytes(sha)).rejects.toThrow(/collision/)
  expect(list).not.toHaveBeenCalled()
  expect(await fs.read('é/sample.bin')).toEqual(bytes)
  expect(await fs.read('é/sample.bin')).toEqual(new Uint8Array([2]))
})

it.each(['additive', 'destructive', 'restoring'] as const)(
  'retains restored-file detection during %s replay',
  async (mode) => {
    const { reconciliationScan } = await import(
      '../../node_modules/@abele/sync-sdk/dist/internal/core/reconciliation.js'
    )
    const fs = Object.assign(new MemoryFileSystem(), { listChildren: async () => [] })
    const state = new MemoryStateStore(),
      bytes = new Uint8Array([1]),
      sha = await sha256(bytes)
    for (const path of ['one.md', 'two.md']) {
      await fs.writeAtomic(path, new Uint8Array([2]), 10)
      await state.put({
        path,
        wirePath: path,
        fileId: path,
        versionId: 'v1',
        sha,
        size: 1,
        mtime: 100,
      })
    }
    await state.setCursor(1)
    await state.setJournal({
      batchId: 'sample',
      idempotencyKey: 'sample',
      startedAt: new Date().toISOString(),
      ops:
        mode === 'destructive'
          ? [{ op: 'delete', file_id: 'one.md', base_version_id: 'v1' }]
          : [{ op: 'create', path: 'new.md', sha, size: 1, mtime: 100 }],
    })
    if (mode === 'restoring') await state.setMeta('server-restore-reconciling', 'yes')
    await reconciliationScan(fs, state, { excluded: () => false }, 1).catch(() => {})
    expect(JSON.parse((await state.getMeta('content-reconciliation'))!)).toMatchObject({
      phase: 'requested',
      reason: expect.stringContaining('older timestamps'),
    })
  }
)

it.each([false, true])(
  'bounds fresh replay stats and drains reads before returning (failure=%s)',
  async (fail) => {
    const { reconciliationScan } = await import(
      '../../node_modules/@abele/sync-sdk/dist/internal/core/reconciliation.js'
    )
    const state = new MemoryStateStore()
    for (let i = 0; i < 70; i++) {
      const path = `Notes/sample-${i}.md`
      await state.put({
        path,
        wirePath: path,
        fileId: path,
        versionId: 'v1',
        sha: 'a'.repeat(64),
        size: 1,
        mtime: 1,
      })
    }
    await state.setJournal({
      batchId: 'sample',
      idempotencyKey: 'sample',
      startedAt: new Date().toISOString(),
      ops: [{ op: 'create', path: 'pending.md', sha: 'b'.repeat(64), size: 1, mtime: 1 }],
    })
    let active = 0,
      peak = 0,
      completed = 0
    const stat = vi.fn(async (path: string) => {
      active++
      peak = Math.max(peak, active)
      try {
        if (fail && path.endsWith('sample-0.md')) throw new Error('sample stat failure')
        await new Promise((resolve) => setTimeout(resolve, 1))
        return { path, size: 1, mtime: 1 }
      } finally {
        active--
        completed++
      }
    })
    const fs = Object.assign(new MemoryFileSystem(), { listChildren: async () => [], stat })
    const run = reconciliationScan(fs, state, { excluded: () => false }, 1)
    if (fail) await expect(run).rejects.toThrow('sample stat failure')
    else await run
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(32)
    expect(active).toBe(0)
    expect(completed).toBe(stat.mock.calls.length)
    expect(completed).toBe(fail ? 32 : 70)
  }
)

it('keeps ambiguous ancestors blocked and refreshes directory spelling on the next replay pass', async () => {
  const { refreshLocalPaths } = await import(
    '../../node_modules/@abele/sync-sdk/dist/internal/core/localPaths.js'
  )
  const state = new MemoryStateStore(),
    fs = new MemoryFileSystem()
  for (const name of ['one.md', 'two.md']) {
    const path = `é/${name}`
    await state.put({
      path,
      wirePath: path.normalize('NFC'),
      fileId: name,
      versionId: 'v1',
      sha: 'a'.repeat(64),
      size: 1,
      mtime: 1,
    })
    await fs.writeAtomic(`é/${name}`, new Uint8Array([1]), 1)
  }
  await state.setJournal({
    batchId: 'sample',
    idempotencyKey: 'sample',
    startedAt: new Date().toISOString(),
    ops: [{ op: 'create', path: 'pending.md', sha: 'b'.repeat(64), size: 1, mtime: 1 }],
  })
  let ambiguous = true
  const reads: string[] = []
  Object.assign(fs, {
    listChildren: async (parent: string) => {
      reads.push(parent)
      return parent === ''
        ? [
            { path: 'é', kind: 'directory', identity: 'first' },
            ...(ambiguous ? [{ path: 'é', kind: 'directory', identity: 'second' }] : []),
          ]
        : ['one.md', 'two.md'].map((name) => ({ path: `é/${name}`, kind: 'file' }))
    },
  })
  await refreshLocalPaths(fs, state)
  expect(reads).toEqual([''])
  expect((await state.byFileId('one.md'))?.path).toBe('é/one.md')
  ambiguous = false
  await refreshLocalPaths(fs, state)
  expect(reads).toEqual(['', '', 'é'])
  expect((await state.byFileId('one.md'))?.path).toBe('é/one.md')
  expect((await state.byFileId('two.md'))?.path).toBe('é/two.md')
})

it('propagates cancellation through additive replay ledger collection before directory reads', async () => {
  const { refreshLocalPaths } = await import(
    '../../node_modules/@abele/sync-sdk/dist/internal/core/localPaths.js'
  )
  const state = new MemoryStateStore(),
    controller = new AbortController()
  for (let i = 0; i < 1000; i++) {
    const path = `Notes/sample-${i}.md`
    await state.put({
      path,
      wirePath: path,
      fileId: path,
      versionId: 'v1',
      sha: 'a'.repeat(64),
      size: 1,
      mtime: 1,
    })
  }
  await state.setJournal({
    batchId: 'sample',
    idempotencyKey: 'sample',
    startedAt: new Date().toISOString(),
    ops: [{ op: 'create', path: 'pending.md', sha: 'b'.repeat(64), size: 1, mtime: 1 }],
  })
  const listChildren = vi.fn(async () => [])
  const fs = Object.assign(new MemoryFileSystem(), { listChildren })
  const transaction = vi.spyOn(state, 'transaction')
  const yieldTask = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()
  })
  await expect(
    refreshLocalPaths(fs, state, { signal: controller.signal, yieldTask })
  ).rejects.toThrow()
  expect(yieldTask).toHaveBeenCalledOnce()
  expect(listChildren).not.toHaveBeenCalled()
  expect(transaction).not.toHaveBeenCalled()
})
