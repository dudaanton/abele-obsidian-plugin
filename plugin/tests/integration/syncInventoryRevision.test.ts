import { expect, it, vi } from 'vitest'
import {
  MemoryFileSystem,
  MemoryStateStore,
  SyncEngine,
  selectiveDefaults,
  sha256,
  type EngineClient,
} from '@abele/sync-sdk/core'
import type { CommitOp } from '@abele/sync-sdk/protocol'
import { scanSnapshot } from '../../node_modules/@abele/sync-sdk/dist/internal/core/scanSnapshot.js'

const revisionKey = Symbol.for('abele.sync.local-scan-revision-v1')

it.each(['size mismatch', 'read error'])(
  'retries a tracked edit skipped by a %s without an inventory change',
  async (failure) => {
    let now = 1000
    const s = await fixture(() => now)
    const old = new TextEncoder().encode('before')
    await s.state.put({
      path: 'sample.md',
      wirePath: 'sample.md',
      fileId: 'tracked',
      versionId: 'v1',
      sha: await sha256(old),
      size: old.length,
      mtime: 0,
    })
    let broken = true
    const read = s.fs.read.bind(s.fs)
    const reads = vi.spyOn(s.fs, 'read').mockImplementation(async (path) => {
      if (broken) {
        if (failure === 'read error') throw new Error('temporary sample read error')
        return new Uint8Array(1)
      }
      return read(path)
    })
    try {
      s.engine.start()
      await Reflect.get(s.engine, 'running')
      expect(s.commits).toEqual([])
      expect(await s.state.metadataKeys('file-retry:')).toHaveLength(1)
      expect(Reflect.get(s.engine, 'wake').files).not.toBeNull()
      broken = false
      // A retry deadline expires without any file inventory or watcher event.
      now += 10000
      reads.mockClear()
      await s.engine.sync()
      expect(reads).toHaveBeenCalled()
      expect(s.commits).toContainEqual(
        expect.objectContaining({ op: 'modify', file_id: 'tracked' })
      )
    } finally {
      await s.engine.stop()
      vi.restoreAllMocks()
    }
  }
)

it('does not certify deferred cold discovery as an unchanged inventory', async () => {
  const s = await fixture()
  const path = 'cold-sample.md'
  await s.fs.writeAtomic(path, new TextEncoder().encode('cold sample'), 1)
  let defer = true
  Object.assign(s.fs, {
    deferNewLocalFile: async (info: { path: string }) => defer && info.path === path,
  })
  try {
    s.engine.start()
    await Reflect.get(s.engine, 'running')
    expect(s.commits.some((op) => op.op === 'create' && op.path === path)).toBe(false)
    defer = false
    await s.engine.sync()
    expect(s.commits).toContainEqual(expect.objectContaining({ op: 'create', path }))
  } finally {
    await s.engine.stop()
  }
})

async function fixture(now?: () => number) {
  const fs = new MemoryFileSystem()
  const state = new MemoryStateStore()
  await state.setCursor(1)
  await fs.writeAtomic('sample.md', new TextEncoder().encode('sample'), 1)
  let revision = 0
  // Model a host whose inventory clock advances before per-path watcher delivery.
  Object.assign(fs, { [revisionKey]: () => revision, watch: () => () => {} })
  const commits: CommitOp[] = []
  const logs: string[] = []
  const client = {
    subscribe: () => () => {},
    manifest: async () => ({ items: [], head_seq: 1, next: null }),
    state: async () => ({
      head_seq: 1,
      settings: {
        conflict: 'merge',
        max_file_bytes: 1000000,
        quota_bytes: null,
        retention: { notes_days: 30, attachments_days: 30, settings_days: 30 },
      },
    }),
    changes: async () => ({ items: [], head_seq: 1, next_since: 1 }),
    versions: async () => [],
    hasBlob: vi.fn(async () => true),
    getBlob: vi.fn(async () => {
      throw Error('unexpected download')
    }),
    commitRaw: vi.fn(async (ops: CommitOp[]) => {
      commits.push(...ops)
      return {
        replayed: false,
        body: {
          head_seq: 1,
          results: ops.map((op, n) => ({
            status: 'applied',
            seq: 1,
            file_id: 'file_id' in op ? op.file_id : `new-${commits.length}-${n}`,
            version_id: `v-${commits.length}-${n}`,
            path: 'path' in op ? op.path : 'restored.md',
            sha: 'sha' in op ? op.sha : null,
            size: 'size' in op ? op.size : 0,
            mtime: 'mtime' in op ? op.mtime : 0,
          })),
        },
      }
    }),
  }
  const engine = new SyncEngine({
    fs,
    state,
    client: client as unknown as EngineClient,
    selective: selectiveDefaults(),
    deleteGuard: false,
    log: (line) => logs.push(line),
    ...(now ? { now } : {}),
  })
  return { fs, state, client, engine, commits, logs, bump: () => ++revision }
}

it('finishes a cycle despite a revision bump on every inventory enumeration', async () => {
  const s = await fixture()
  const list = s.fs.list.bind(s.fs)
  let lists = 0
  s.fs.list = async function* () {
    lists++
    yield* list()
    s.bump()
  }
  try {
    await s.engine.sync()
    expect(s.commits).toContainEqual(expect.objectContaining({ op: 'create', path: 'sample.md' }))
    expect(lists).toBeLessThan(20)
    expect(s.engine.status.lastError).toBeNull()
    expect(s.client.getBlob).not.toHaveBeenCalled()
  } finally {
    await s.engine.stop()
  }
})

it('does not schedule another pass for inventory changes already consumed before the scan', async () => {
  const s = await fixture()
  vi.spyOn(s.client, 'changes').mockImplementationOnce(async () => {
    s.bump()
    return { items: [], head_seq: 1, next_since: 1 }
  })
  try {
    s.engine.start()
    await vi.waitFor(() => expect(s.engine.status.lastSyncAt).not.toBeNull())
    await s.engine.stop()
    expect(s.logs.some((line) => line === 'sync: inventory changed')).toBe(false)
  } finally {
    await s.engine.stop()
  }
})

it('finishes a 33k inventory with an edit at every row without restarting enumeration', async () => {
  const s = await fixture()
  let lists = 0
  s.fs.list = async function* () {
    lists++
    for (let i = 0; i < 33000; i++) {
      yield { path: `Notes/sample-${i}.md`, size: 1, mtime: 1 }
      s.bump()
    }
  }
  const snapshot = scanSnapshot(s.fs, () => undefined)
  try {
    expect(await Array.fromAsync(snapshot.fs.list())).toHaveLength(33000)
    expect(lists).toBe(1)
    expect(await Array.fromAsync(snapshot.fs.list())).toHaveLength(33000)
    expect(lists).toBe(2)
  } finally {
    await s.engine.stop()
  }
})

it('completes automatic follow-up cycles under constant edits and pauses their queue', async () => {
  const s = await fixture()
  const list = s.fs.list.bind(s.fs)
  let completed = 0
  s.fs.list = async function* () {
    yield* list()
    s.bump()
  }
  const unlisten = s.engine.onStatus((status) => {
    if (status.state === 'idle' && status.lastSyncAt && ++completed === 2) s.engine.pause()
  })
  try {
    s.engine.start()
    await vi.waitFor(() => expect(completed).toBe(2))
    await vi.waitFor(() => expect(s.engine.status.state).toBe('paused'))
    expect(s.commits).toHaveLength(1)
    expect(s.client.getBlob).not.toHaveBeenCalled()
  } finally {
    unlisten()
    await s.engine.stop()
  }
})

it.each(['enumeration', 'upload'] as const)(
  'keeps a file restored during %s and automatically uploads a late file',
  async (phase) => {
    const s = await fixture()
    const bytes = new TextEncoder().encode('restored')
    await s.state.put({
      path: 'restored.md',
      wirePath: 'restored.md',
      fileId: 'restored-file',
      versionId: 'base',
      sha: await sha256(bytes),
      size: bytes.length,
      mtime: 1,
    })
    let restored = false
    const restore = async () => {
      if (restored) return
      restored = true
      await s.fs.writeAtomic('restored.md', bytes, 1)
      await s.fs.writeAtomic('late.md', new TextEncoder().encode('late edit'), 2)
      s.bump()
    }
    if (phase === 'enumeration') {
      const list = s.fs.list.bind(s.fs)
      s.fs.list = async function* () {
        yield* list()
        await restore()
      }
    } else
      s.client.hasBlob.mockImplementation(async () => {
        await restore()
        return true
      })
    try {
      s.engine.start()
      await vi.waitFor(
        () =>
          expect(s.commits, s.logs.join('\n')).toContainEqual(
            expect.objectContaining({ op: 'create', path: 'late.md' })
          ),
        { timeout: 2000 }
      )
      expect(s.commits.some((op) => op.op === 'delete')).toBe(false)
      expect(await s.fs.read('restored.md')).toEqual(bytes)
      expect(s.client.getBlob).not.toHaveBeenCalled()
    } finally {
      await s.engine.stop()
    }
  }
)

it('pauses promptly while inventory revisions keep changing', async () => {
  const s = await fixture()
  const list = s.fs.list.bind(s.fs)
  let entered!: () => void
  let release!: () => void
  const reading = new Promise<void>((resolve) => {
    entered = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  s.fs.list = async function* () {
    yield* list()
    s.bump()
    entered()
    await gate
  }
  try {
    const run = s.engine.sync()
    const rejected = expect(run).rejects.toThrow('sync stopped')
    await reading
    s.engine.pause()
    release()
    await rejected
    expect(s.engine.status.state).toBe('paused')
    expect(s.commits).toEqual([])
  } finally {
    release()
    await s.engine.stop()
  }
})
