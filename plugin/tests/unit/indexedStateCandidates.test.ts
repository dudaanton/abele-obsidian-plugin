import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { caseKey } from '@abele/sync-sdk/protocol'
import { PORTABLE_CANDIDATES } from '@/sync/ledgerPathCandidates'

it('reads only the bounded spelling bucket when checking a ledger occupant', async () => {
  const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-candidates')
  const fullReads = vi.spyOn(IDBObjectStore.prototype, 'getAll')
  try {
    await state.transaction(async (tx) => {
      for (let i = 0; i < 1024; i++)
        await tx.put({
          path: `Notes/Sample ${i}.md`,
          wirePath: `Notes/Sample ${i}.md`,
          fileId: `sample-${i}`,
          versionId: 'sample-version',
          sha: 'a'.repeat(64),
          size: 1,
          mtime: 1,
        })
    })
    const all = vi.spyOn(state, 'all')
    const candidates = Reflect.get(state, 'pathCandidates')
    expect(typeof candidates).toBe('function')
    const rows = []
    for await (const entry of candidates.call(state, 'notes/sample 3.md', caseKey)) rows.push(entry)
    expect(rows.map((entry) => entry.fileId)).toEqual(['sample-3'])
    expect(all).not.toHaveBeenCalled()
    expect(fullReads).not.toHaveBeenCalled()
  } finally {
    fullReads.mockRestore()
    state.close()
  }
})

it('migrates an existing ledger and updates spelling buckets atomically', async () => {
  const factory = new IDBFactory()
  const entry = {
    path: 'Notes/Cafe\u0301.md',
    wirePath: 'Notes/Café.md',
    fileId: 'sample-file',
    versionId: 'sample-version',
    sha: 'b'.repeat(64),
    size: 1,
    mtime: 2,
  }
  const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('sample-upgrade', 2)
    request.onupgradeneeded = () => {
      const entries = request.result.createObjectStore('entries', { keyPath: 'path' })
      entries.createIndex('byFileId', 'fileId')
      entries.createIndex('byWirePath', 'wirePath')
      entries.put(entry)
      request.result.createObjectStore('meta', { keyPath: 'key' }).put({ key: 'cursor', value: 7 })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  legacy.close()
  const state = await IndexedDbStateStore.open(factory, 'sample-upgrade')
  const rows = async (path: string, key?: (path: string) => string) => {
    const result = []
    for await (const entry of state.pathCandidates(path, key)) result.push(entry)
    return result
  }
  try {
    expect(await state.getCursor()).toBe(7)
    expect(await rows('notes/café.md')).toEqual([entry])
    await expect(
      state.transaction(async (tx) => {
        await tx.delete(entry.path)
        await tx.put({ ...entry, path: 'Notes/Other.md', wirePath: 'Notes/Other.md' })
        throw new Error('sample abort')
      })
    ).rejects.toThrow('sample abort')
    expect(await rows('notes/café.md')).toEqual([entry])
    expect(await rows('notes/other.md')).toEqual([])
    await state.put({ ...entry, path: 'Notes/Other.md', wirePath: 'Notes/Other.md' })
    expect(await rows('notes/café.md')).toEqual([])
    expect((await rows('notes/other.md')).map((entry) => entry.fileId)).toEqual(['sample-file'])
    await state.delete('Notes/Other.md')
    expect(await rows('notes/other.md')).toEqual([])
  } finally {
    state.close()
  }
})

it('filters broad indexed aliases with the host policy and scans unknown policies', async () => {
  const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-policy')
  try {
    for (const [i, path] of ['Notes/Case.md', 'Notes/case.md', 'Notes/Case.md.'].entries())
      await state.put({
        path,
        wirePath: path,
        fileId: `sample-${i}`,
        versionId: 'sample-version',
        sha: 'c'.repeat(64),
        size: 1,
        mtime: 1,
      })
    const sensitive = (path: string) => path.normalize('NFC')
    Reflect.set(sensitive, PORTABLE_CANDIDATES, true)
    const actual = []
    for await (const entry of state.pathCandidates('Notes/Case.md', sensitive))
      actual.push(entry.path)
    expect(actual).toEqual(['Notes/Case.md'])
    const all = vi.spyOn(state, 'all')
    const custom = () => 'same'
    const found = []
    for await (const entry of state.pathCandidates('anything', custom)) found.push(entry.path)
    expect(found).toHaveLength(3)
    expect(all).toHaveBeenCalledOnce()
  } finally {
    state.close()
  }
})
