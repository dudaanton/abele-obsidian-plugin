// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore, IDBCursor, IDBKeyRange } from 'fake-indexeddb'
import { MemoryFileSystem, MemoryStateStore, type StateEntry } from '@abele/sync-sdk/core'
import { DeleteGate } from '../../node_modules/@abele/sync-sdk/dist/internal/core/deleteGate.js'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { assertPhysicalPath } from '@/sync/external/projection'
import { scopedFileSystem } from '@/sync/scopedFileSystem'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'

const count = 33000
const directory = Array.from({ length: 12 }, (_, i) => `Section Café ${i}`).join('/')

async function tasks<T>(work: () => Promise<T>) {
  let last = performance.now(),
    longest = 0
  const tick = () => {
    const now = performance.now()
    longest = Math.max(longest, now - last)
    last = now
  }
  const timer = setInterval(tick, 0)
  try {
    const result = await work()
    tick()
    console.info('inventory tasks', { longest })
    expect(longest).toBeLessThan(50)
    return result
  } finally {
    clearInterval(timer)
  }
}

it('keeps selection and deletion path checks below 50 ms for 33k entries', async () => {
  const entries: StateEntry[] = Array.from({ length: count }, (_, i) => ({
    path: `Notes/${directory}/Sample ${i}.md`,
    wirePath: `Notes/${directory}/Sample ${i}.md`,
    fileId: `sample-${i}`,
    versionId: 'sample-version',
    sha: 'a'.repeat(64),
    size: 1,
    mtime: 1,
  }))
  const state = new MemoryStateStore()
  state.all = async function* () {
    yield* entries
  }
  const held = vi.fn(async () => false)
  let checked = 0
  const gate = new DeleteGate({
    state,
    filter: {
      excluded(path: string) {
        checked++
        assertPhysicalPath(path)
        return false
      },
    },
    holds: { list: async () => [], recent: async () => 0, record: held, setNoted: async () => {} },
    now: () => 1,
    deleteGuard: false,
    onHeld: () => {},
    log: () => {},
  } as never)
  const ops = entries.map((entry) => ({
    op: 'delete' as const,
    file_id: entry.fileId,
    base_version_id: entry.versionId,
  }))
  const result = await tasks(() => gate.judge(ops, new Set()))
  expect(result).toEqual(ops)
  expect(checked).toBe(count)
  expect(held).toHaveBeenCalledWith([])
}, 30000)

it('keeps confirmed deletes and sticky holds while cooperatively partitioning operations', async () => {
  const state = new MemoryStateStore()
  for (let i = 0; i < 80; i++)
    await state.put({
      path: `Notes/Guard ${i}.md`,
      wirePath: `Notes/Guard ${i}.md`,
      fileId: `guard-${i}`,
      versionId: 'v1',
      sha: 'b'.repeat(64),
      size: 1,
      mtime: 1,
    })
  const record = vi.fn(async () => true)
  const gate = new DeleteGate({
    state,
    filter: { excluded: () => false },
    holds: {
      list: async () => [{ fileId: 'guard-1', path: 'Notes/Guard 1.md' }],
      recent: async () => 0,
      record,
      setNoted: async () => {},
    },
    now: () => 1,
    deleteGuard: { count: 50, floor: 10, share: 0.25 },
    onHeld: () => {},
    log: () => {},
  } as never)
  const ops = Array.from({ length: 60 }, (_, i) => ({
    op: 'delete' as const,
    file_id: `guard-${i}`,
    base_version_id: 'v1',
  }))
  const confirmed = new Set(['guard-0'])
  expect(await gate.judge(ops, confirmed)).toEqual([ops[0]])
  expect(record).toHaveBeenCalledWith(
    ops.slice(1).map((op, i) => ({ fileId: op.file_id, path: `Notes/Guard ${i + 1}.md` }))
  )
})

it('keeps scoped and placed sibling selection below 50 ms for 33k entries', async () => {
  const children = Array.from({ length: count }, (_, i) => ({
    path: `Local/${directory}/Sample ${i}.md`,
    kind: 'file' as const,
  }))
  const base = Object.assign(new MemoryFileSystem(), { listChildren: async () => children })
  let checked = 0
  const fs = new LocalFolderPlacement('Remote', 'Local').fileSystem(
    scopedFileSystem(base, assertPhysicalPath, (path) => {
      checked++
      assertPhysicalPath(path)
      return true
    })
  )
  const result = await tasks(() => fs.listChildren!(`Remote/${directory}`))
  expect(result).toHaveLength(count)
  expect(result[0].path).toBe(`Remote/${directory}/Sample 0.md`)
  expect(result[count - 1].path).toBe(`Remote/${directory}/Sample ${count - 1}.md`)
  expect(checked).toBe(count)
}, 30000)

it('reads 33k plugin metadata keys and values with bounded request callbacks', async () => {
  const factory = new IDBFactory()
  const state = await IndexedDbStateStore.open(factory, 'sample-metadata-tasks')
  // Seed one native transaction, outside the measured read. No per-row commit history.
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = factory.open('sample-metadata-tasks', 3)
    request.onsuccess = () => resolve(request.result)
  })
  const tx = db.transaction('meta', 'readwrite')
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  for (let i = 0; i < count; i++)
    tx.objectStore('meta').put({
      key: `plugin:sample:${String(i).padStart(5, '0')}`,
      value: `value-${i}:` + 'x'.repeat(1024),
    })
  tx.objectStore('meta').put({ key: 'plugin:unrelated', value: 'keep' })
  tx.objectStore('meta').put({ key: 'cursor', value: 19 })
  await done
  db.close()
  const all = vi.spyOn(IDBObjectStore.prototype, 'getAll')
  const keys = vi.spyOn(IDBObjectStore.prototype, 'getAllKeys')
  const cursors = vi.spyOn(IDBCursor.prototype, 'continue')
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  try {
    const listed = await tasks(() => state.metadataKeys('sample:'))
    expect(listed).toHaveLength(count)
    expect(new Set(listed).size).toBe(count)
    expect(listed[0]).toBe('sample:00000')
    expect(listed[count - 1]).toBe('sample:32999')
    const rows = await tasks(() => state.pluginMeta())
    expect(rows.size).toBe(count + 1)
    expect(rows.get('sample:00000')).toBe('value-0:' + 'x'.repeat(1024))
    expect(rows.get('sample:32999')).toBe('value-32999:' + 'x'.repeat(1024))
    expect(rows.get('unrelated')).toBe('keep')
    expect(await state.getCursor()).toBe(19)
    // Unbounded IDB result materialization runs before the promise can yield.
    for (const args of [...all.mock.calls, ...keys.mock.calls])
      expect(args[1]).toBeLessThanOrEqual(256)
    expect(
      all.mock.calls.length + keys.mock.calls.length + cursors.mock.calls.length
    ).toBeLessThanOrEqual(2 * Math.ceil(count / 256) + 8)
  } finally {
    all.mockRestore()
    keys.mockRestore()
    cursors.mockRestore()
    vi.unstubAllGlobals()
    state.close()
  }
}, 30000)
