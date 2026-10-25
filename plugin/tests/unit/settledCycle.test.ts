import { expect, it, vi } from 'vitest'
import {
  MemoryFileSystem,
  MemoryStateStore,
  selectiveDefaults,
  SyncEngine,
  type EngineClient,
  sha256,
} from '@abele/sync-sdk/core'
import { AbeleError, VaultSettingsSchema } from '@abele/sync-sdk/protocol'
import { FileRetries } from '../../node_modules/@abele/sync-sdk/dist/internal/core/fileRetry.js'

it('expires an unchanged watched proof from its last ordinary inspection, despite frequent cycles', async () => {
  let now = 1000
  const fs = Object.assign(new MemoryFileSystem(), {
    [Symbol.for('abele.sync.local-scan-revision-v1')]: () => 'sample-revision',
  })
  const state = new MemoryStateStore()
  const path = 'Notes/sample.bin'
  const initial = new Uint8Array([1]),
    changed = new Uint8Array([2])
  await fs.writeAtomic(path, initial, 1000)
  await state.put({
    path,
    wirePath: path,
    fileId: 'sample',
    versionId: 'initial',
    sha: await sha256(initial),
    size: 1,
    mtime: 1000,
  })
  await state.setCursor(1)
  const list = vi.spyOn(fs, 'list')
  let head = 1
  const commitRaw = vi.fn(async () => {
    head = 2
    return {
      replayed: false,
      body: {
        head_seq: head,
        results: [
          {
            status: 'applied',
            file_id: 'sample',
            version_id: 'changed',
            path,
            sha: await sha256(changed),
            size: 1,
            mtime: 1000,
            kind: 'attachment',
          },
        ],
      },
    }
  })
  const client = {
    state: async () => ({ head_seq: head, settings: VaultSettingsSchema.parse({}), usage: {} }),
    changes: async () => ({ items: [], head_seq: head, next_since: head }),
    subscribe: () => () => {},
    hasBlob: async () => false,
    putBlob: async () => {},
    commitRaw,
  } as unknown as EngineClient
  const engine = new SyncEngine({
    fs,
    state,
    client,
    selective: selectiveDefaults(),
    now: () => now,
  })
  try {
    engine.start()
    await Reflect.get(engine, 'running')
    list.mockClear()
    // Simulate an unobservable writer: same length and date, no event/revision change.
    await fs.writeAtomic(path, changed, 1000)
    for (let i = 0; i < 5; i++) {
      now += 50000
      await engine.sync()
      expect(list).not.toHaveBeenCalled()
      expect(commitRaw).not.toHaveBeenCalled()
    }
    now += 50000
    await engine.sync()
    expect(list).toHaveBeenCalled()
    expect(commitRaw).toHaveBeenCalledOnce()
    expect((await state.get(path))?.sha).toBe(await sha256(changed))
    list.mockClear()
    await engine.sync()
    expect(list).not.toHaveBeenCalled()
    now -= 1
    await engine.sync()
    expect(list).toHaveBeenCalled()
  } finally {
    await engine.stop()
  }
})

it('leaves a stable size refusal waiting without scheduling another whole cycle', async () => {
  const state = new MemoryStateStore()
  const retries = new FileRetries(
    state,
    () => 1000,
    () => {}
  )
  await retries.failed('Notes/sample.bin', 'push', new Error('too_large: exceeds server cap'))
  expect(await retries.next()).toBeNull()
  expect(retries.list()).toHaveLength(1)
  await retries.retryPaths(['Notes/sample.bin'])
  expect(retries.ready('Notes/sample.bin', 'push')).toBe(true)
  await retries.refreshServerPolicy('new-limits', 2)
  expect(retries.list()).toEqual([])
})

it('continues automatically retrying temporary quota contention', async () => {
  const retries = new FileRetries(
    new MemoryStateStore(),
    () => 1000,
    () => {}
  )
  await retries.failed('Notes/sample.bin', 'push', new Error('quota_waiting: outstanding uploads'))
  expect(await retries.next()).toBe(6000)
})

it('stays idle with one policy-held file and retries when the size cap changes', async () => {
  const fs = Object.assign(new MemoryFileSystem(), {
    [Symbol.for('abele.sync.local-scan-revision-v1')]: () => 'sample-revision',
  })
  const state = new MemoryStateStore(),
    bytes = new Uint8Array([1, 2])
  await fs.writeAtomic('Notes/sample.bin', bytes, 1000)
  await state.setCursor(1)
  let cap = 1,
    head = 1
  const list = vi.spyOn(fs, 'list')
  const commitRaw = vi.fn(async () => {
    head = 2
    return {
      replayed: false,
      body: {
        head_seq: head,
        results: [
          {
            status: 'applied',
            file_id: 'sample',
            version_id: 'version',
            path: 'Notes/sample.bin',
            kind: 'attachment',
            sha: await sha256(bytes),
            size: 2,
            mtime: 1000,
          },
        ],
      },
    }
  })
  const client = {
    reportSizeRefusals: true,
    state: async () => ({
      head_seq: head,
      settings: VaultSettingsSchema.parse({ max_file_bytes: cap }),
      usage: {},
    }),
    changes: async () => ({ items: [], head_seq: head, next_since: head }),
    hasBlob: async () => false,
    putBlob: async () => {
      if (bytes.length > cap) throw new AbeleError('too_large', 'Sample file exceeds cap')
    },
    commitRaw,
    subscribe: () => () => {},
  } as unknown as EngineClient
  const engine = new SyncEngine({ fs, state, client, selective: selectiveDefaults() })
  try {
    engine.start()
    await Reflect.get(engine, 'running')
    expect(engine.status.state).toBe('idle')
    expect(engine.status.waiting).toBe(1)
    expect(Reflect.get(engine, 'wake').files).toBeNull()
    list.mockClear()
    await engine.sync()
    expect(list).not.toHaveBeenCalled()
    expect(engine.status.state).toBe('idle')
    cap = 4
    await engine.sync()
    expect(commitRaw).toHaveBeenCalledOnce()
    expect((await state.get('Notes/sample.bin'))?.sha).toBe(await sha256(bytes))
    expect(engine.status.waiting).toBe(0)
  } finally {
    await engine.stop()
  }
})

it('retires a size-wait schedule when the unuploaded source is deleted', async () => {
  const fs = Object.assign(new MemoryFileSystem(), {
    [Symbol.for('abele.sync.local-scan-revision-v1')]: () => 'sample-revision',
  })
  const state = new MemoryStateStore()
  await state.setCursor(1)
  await fs.writeAtomic('Notes/sample.bin', new Uint8Array([1, 2]), 1000)
  const client = {
    reportSizeRefusals: true,
    state: async () => ({
      head_seq: 1,
      settings: VaultSettingsSchema.parse({ max_file_bytes: 1 }),
      usage: {},
    }),
    changes: async () => ({ items: [], head_seq: 1, next_since: 1 }),
    hasBlob: async () => false,
    putBlob: async () => {
      throw new AbeleError('too_large', 'Sample cap')
    },
    subscribe: () => () => {},
  } as unknown as EngineClient
  const engine = new SyncEngine({ fs, state, client, selective: selectiveDefaults() })
  try {
    engine.start()
    await Reflect.get(engine, 'running')
    expect(engine.status.waiting).toBe(1)
    await fs.remove('Notes/sample.bin')
    fs.emitChange(['Notes/sample.bin'])
    await engine.sync()
    expect(engine.status.waiting).toBe(0)
    expect(await state.metadataKeys('file-retry:')).toEqual([])
    expect(Reflect.get(engine, 'wake').files).toBeNull()
  } finally {
    await engine.stop()
  }
})

it('rescans a ledger-only keep-local decision without a filesystem event', async () => {
  const fs = Object.assign(new MemoryFileSystem(), {
    [Symbol.for('abele.sync.local-scan-revision-v1')]: () => 'sample-revision',
  })
  const state = new MemoryStateStore(),
    bytes = new Uint8Array([1]),
    sha = await sha256(bytes)
  const entry = {
    path: 'Notes/sample.bin',
    wirePath: 'Notes/sample.bin',
    fileId: 'sample',
    versionId: 'first',
    sha,
    size: 1,
    mtime: 1000,
  }
  await fs.writeAtomic(entry.path, bytes, 1000)
  await state.put(entry)
  await state.setCursor(1)
  let head = 1
  const commitRaw = vi.fn(async () => ({
    replayed: false,
    body: {
      head_seq: head,
      results: [
        {
          status: 'applied',
          file_id: 'sample',
          version_id: 'final',
          path: entry.path,
          sha,
          size: 1,
          mtime: 1000,
          kind: 'attachment',
        },
      ],
    },
  }))
  const client = {
    state: async () => ({ head_seq: head, settings: VaultSettingsSchema.parse({}), usage: {} }),
    changes: async () => ({ items: [], head_seq: head, next_since: head }),
    hasBlob: async () => false,
    putBlob: async () => {},
    commitRaw,
    subscribe: () => () => {},
  } as unknown as EngineClient
  const engine = new SyncEngine({ fs, state, client, selective: selectiveDefaults() })
  try {
    engine.start()
    await Reflect.get(engine, 'running')
    expect(engine.status.state).toBe('idle')
    head = 2
    await state.put({ ...entry, versionId: 'remote', sha: 'b'.repeat(64), mtime: -1 })
    await engine.sync()
    expect(commitRaw).toHaveBeenCalledOnce()
    expect((await state.get(entry.path))?.sha).toBe(sha)
  } finally {
    await engine.stop()
  }
})

it('rechecks the local revision after awaiting a ledger proof', async () => {
  let revision = 0,
    mutate = false
  const fs = Object.assign(new MemoryFileSystem(), {
    [Symbol.for('abele.sync.local-scan-revision-v1')]: () => String(revision),
  })
  const state = new MemoryStateStore(),
    path = 'Notes/sample.bin'
  const first = new Uint8Array([1]),
    next = new Uint8Array([2]),
    sha = await sha256(next)
  await fs.writeAtomic(path, first, 1000)
  await state.put({
    path,
    wirePath: path,
    fileId: 'sample',
    versionId: 'first',
    sha: await sha256(first),
    size: 1,
    mtime: 1000,
  })
  await state.setCursor(1)
  const port = Symbol.for('abele.sync.local-scan-state-revision-v1')
  const original = Reflect.get(state, port).bind(state)
  Object.assign(state, {
    [port]: async () => {
      if (mutate) {
        mutate = false
        await fs.writeAtomic(path, next, 2000)
        revision++
      }
      return original()
    },
  })
  const commitRaw = vi.fn(async () => ({
    replayed: false,
    body: {
      head_seq: 2,
      results: [
        {
          status: 'applied',
          file_id: 'sample',
          version_id: 'final',
          path,
          sha,
          size: 1,
          mtime: 2000,
          kind: 'attachment',
        },
      ],
    },
  }))
  const client = {
    state: async () => ({ head_seq: 1, settings: VaultSettingsSchema.parse({}), usage: {} }),
    changes: async () => ({ items: [], head_seq: 1, next_since: 1 }),
    hasBlob: async () => false,
    putBlob: async () => {},
    commitRaw,
    subscribe: () => () => {},
  } as unknown as EngineClient
  const engine = new SyncEngine({ fs, state, client, selective: selectiveDefaults() })
  try {
    engine.start()
    await Reflect.get(engine, 'running')
    mutate = true
    await engine.sync()
    expect(commitRaw).toHaveBeenCalledOnce()
    expect((await state.get(path))?.sha).toBe(sha)
  } finally {
    await engine.stop()
  }
})

it('publishes each durable feed-page cursor before asking for another page', async () => {
  const state = new MemoryStateStore(),
    fs = new MemoryFileSystem()
  const bytes = new Uint8Array([37]),
    sha = await sha256(bytes)
  await state.setCursor(1)
  await fs.writeAtomic('Notes/sample.bin', bytes, 1000)
  await state.put({
    path: 'Notes/sample.bin',
    wirePath: 'Notes/sample.bin',
    fileId: 'sample',
    versionId: 'version',
    sha,
    size: 1,
    mtime: 1000,
  })
  let page = 0,
    engine: SyncEngine
  const client = {
    state: async () => ({ head_seq: 3, settings: VaultSettingsSchema.parse({}), usage: {} }),
    changes: async () => {
      if (page++) {
        expect(await state.getCursor()).toBe(2)
        expect(engine.status.cursor).toBe(2)
        return { items: [], head_seq: 3, next_since: 3 }
      }
      return {
        items: [
          {
            path: 'Notes/sample.bin',
            file_id: 'sample',
            version_id: 'version',
            sha,
            size: 1,
            mtime: 1000,
            seq: 2,
            op: 'create',
            prev_path: null,
            kind: 'attachment',
          },
        ],
        head_seq: 3,
        next_since: 2,
      }
    },
  } as unknown as EngineClient
  engine = new SyncEngine({ fs, state, client, selective: selectiveDefaults() })
  try {
    await engine.sync()
    expect(engine.status.cursor).toBe(3)
  } finally {
    await engine.stop()
  }
})
