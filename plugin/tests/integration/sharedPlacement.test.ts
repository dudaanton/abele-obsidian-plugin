import { expect, it } from 'vitest'
import { MemoryFileSystem, MemoryStateStore, ExpectedWrites, sha256 } from '@abele/sync-sdk/core'
import { PullPlacer } from '../../node_modules/@abele/sync-sdk/dist/internal/core/pullPlace.js'
import { coordinatedFileSystem, PathCoordinator } from '@/sync/pathCoordinator'
import { deferred } from '../helpers/deferred'
import type { ChangeItem } from '@abele/sync-sdk/protocol'
import { EditCopies } from '@/sync/editCopies'

const encode = (s: string) => new TextEncoder().encode(s)
async function change(text: string, version: string): Promise<ChangeItem> {
  return {
    seq: 1,
    file_id: 'sample-file',
    version_id: version,
    path: 'sample.md',
    prev_path: null,
    op: 'modify',
    kind: 'note',
    sha: await sha256(encode(text)),
    size: text.length,
    mtime: 20,
    at: '2025-01-01T00:00:00Z',
    actor: { kind: 'system', id: 'sample', name: 'Sample' },
  }
}
it('keeps ownership through the durable ledger update of competing pulls', async () => {
  const disk = new MemoryFileSystem()
  await disk.writeAtomic('sample.md', encode('base'), 10)
  const fs = coordinatedFileSystem(disk, new PathCoordinator())
  const a = new MemoryStateStore(),
    b = new MemoryStateStore()
  const base = {
    path: 'sample.md',
    wirePath: 'sample.md',
    fileId: 'sample-file',
    versionId: 'base',
    sha: await sha256(encode('base')),
    size: 4,
    mtime: 10,
  }
  await a.put(base)
  await b.put(base)
  const gate = deferred<void>(),
    placed = deferred<void>()
  const original = a.put.bind(a)
  a.put = async (entry) => {
    placed.resolve()
    await gate.promise
    await original(entry)
  }
  const one = await change('first', 'one'),
    two = await change('second', 'two')
  const placer = (state: MemoryStateStore, item: ChangeItem, text: string) =>
    new PullPlacer(
      { getBlob: async () => encode(text) },
      fs,
      state,
      { dirty: new Set(), expected: new ExpectedWrites(), filter: { excluded: () => false } },
      sha256
    )
  const first = placer(a, one, 'first').place(one, one.sha!, base, new Map(), new Map())
  await placed.promise
  let finished = false
  const second = placer(b, two, 'second')
    .place(two, two.sha!, base, new Map(), new Map())
    .then((result) => {
      finished = true
      return result
    })
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(finished).toBe(false)
  gate.resolve()
  expect(await first).toBe(true)
  expect(await second).toBe(false)
  expect(new TextDecoder().decode(await disk.read('sample.md'))).toBe('first')
  expect((await a.get('sample.md'))?.versionId).toBe('one')
  expect((await b.get('sample.md'))?.versionId).toBe('base')
})

it('holds an edit made during download while an unrelated path finishes', async () => {
  const disk = new MemoryFileSystem(),
    state = new MemoryStateStore()
  await disk.writeAtomic('sample.md', encode('base'), 10)
  const base = {
    path: 'sample.md',
    wirePath: 'sample.md',
    fileId: 'sample-file',
    versionId: 'base',
    sha: await sha256(encode('base')),
    size: 4,
    mtime: 10,
  }
  await state.put(base)
  const started = deferred<void>(),
    downloaded = deferred<void>()
  const fs = coordinatedFileSystem(disk, new PathCoordinator())
  const remote = await change('remote', 'remote-version')
  const placer = new PullPlacer(
    {
      getBlob: async () => {
        started.resolve()
        await downloaded.promise
        return encode('remote')
      },
    },
    fs,
    state,
    { dirty: new Set(), expected: new ExpectedWrites(), filter: { excluded: () => false } },
    sha256
  )
  const pending = placer.place(remote, remote.sha!, base, new Map(), new Map())
  await started.promise
  const other = { ...remote, path: 'other.md', file_id: 'other-file' }
  expect(
    await placer.place(
      other,
      other.sha!,
      null,
      new Map([[other.sha!, encode('remote')]]),
      new Map()
    )
  ).toBe(true)
  await disk.writeAtomic('sample.md', encode('user edit'), 30)
  downloaded.resolve()
  expect(await pending).toBe(false)
  expect(new TextDecoder().decode(await disk.read('sample.md'))).toBe('user edit')
  expect((await state.get('sample.md'))?.versionId).toBe('base')
})

it('captures each destination before a settled fast-server merge replaces the submitted source', async () => {
  const disk = new MemoryFileSystem(),
    a = new MemoryStateStore(),
    b = new MemoryStateStore()
  const copies = new EditCopies()
  copies.expect(['fast', 'offline'])
  copies.register('fast', a, () => true)
  copies.register('offline', b, () => true)
  const fs = coordinatedFileSystem(
    disk,
    new PathCoordinator(),
    () => {},
    (paths) => copies.capture(disk, paths)
  )
  await disk.writeAtomic('sample.md', encode('local edit'), 12)
  const submitted = {
    path: 'sample.md',
    wirePath: 'sample.md',
    fileId: 'sample-file',
    versionId: 'base',
    sha: await sha256(encode('local edit')),
    size: 10,
    mtime: 12,
  }
  // Scoped settlement presents the immutable submitted base while its durable ledger
  // still names the prior server version.
  const settledView = new Proxy(a, {
    get(target, key) {
      if (key === 'get')
        return async (path: string) => (path === submitted.path ? submitted : target.get(path))
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const remote = await change('merged result', 'merged')
  const placer = new PullPlacer(
    { getBlob: async () => encode('merged result') },
    fs,
    settledView,
    { dirty: new Set(), expected: new ExpectedWrites(), filter: { excluded: () => false } },
    sha256
  )
  expect(await placer.place(remote, remote.sha!, submitted, new Map(), new Map())).toBe(true)
  expect(new TextDecoder().decode(await disk.read('sample.md'))).toBe('merged result')
  for (const destination of [a, b])
    expect((await copies.list(destination))[0].bytes).toEqual([...encode('local edit')])
})

it('reserves both rename paths through commit before a competing delete can inspect its source', async () => {
  const disk = new MemoryFileSystem(),
    a = new MemoryStateStore(),
    b = new MemoryStateStore()
  await disk.writeAtomic('sample.md', encode('base'), 10)
  const base = {
    path: 'sample.md',
    wirePath: 'sample.md',
    fileId: 'sample-file',
    versionId: 'base',
    sha: await sha256(encode('base')),
    size: 4,
    mtime: 10,
  }
  await a.put(base)
  await b.put(base)
  const fs = coordinatedFileSystem(disk, new PathCoordinator())
  const create = (state: MemoryStateStore) =>
    new PullPlacer(
      { getBlob: async () => encode('base') },
      fs,
      state,
      { dirty: new Set(), expected: new ExpectedWrites(), filter: { excluded: () => false } },
      sha256
    )
  const remote = {
    ...(await change('base', 'renamed')),
    path: 'renamed.md',
    prev_path: 'sample.md',
  }
  const committing = deferred<void>(),
    committed = deferred<void>(),
    original = a.put.bind(a)
  a.put = async (entry) => {
    committing.resolve()
    await committed.promise
    await original(entry)
  }
  const rename = create(a).place(remote, remote.sha!, base, new Map(), new Map())
  await committing.promise
  let deleted = false
  const deletion = create(b)
    .drop(base)
    .then((result: boolean) => {
      deleted = true
      return result
    })
  await Promise.resolve()
  await Promise.resolve()
  expect(deleted).toBe(false)
  committed.resolve()
  expect(await rename).toBe(true)
  await deletion
  expect(await disk.stat('sample.md')).toBeNull()
  expect(new TextDecoder().decode(await disk.read('renamed.md'))).toBe('base')
  expect((await a.get('renamed.md'))?.versionId).toBe('renamed')
})
