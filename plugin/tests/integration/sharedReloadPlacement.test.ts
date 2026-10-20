import { expect, it } from 'vitest'
import { MemoryFileSystem, MemoryStateStore, ExpectedWrites, sha256 } from '@abele/sync-sdk/core'
import { PullPlacer } from '../../node_modules/@abele/sync-sdk/dist/internal/core/pullPlace.js'
import { coordinatedFileSystem, pathCoordinatorOf } from '@/sync/pathCoordinator'
import { deferred } from '../helpers/deferred'
import type { ChangeItem } from '@abele/sync-sdk/protocol'

it('makes a reloaded runtime wait for the old placement and then recover only its recorded intent', async () => {
  const host = {},
    disk = new MemoryFileSystem(),
    state = new MemoryStateStore()
  const bytes = (text: string) => new TextEncoder().encode(text)
  const base = {
    path: 'sample.md',
    wirePath: 'sample.md',
    fileId: 'sample-file',
    versionId: 'base',
    sha: await sha256(bytes('base')),
    size: 4,
    mtime: 10,
  }
  const change: ChangeItem = {
    seq: 1,
    file_id: base.fileId,
    version_id: 'received',
    path: base.path,
    prev_path: null,
    op: 'modify',
    kind: 'note',
    sha: await sha256(bytes('received')),
    size: 8,
    mtime: 20,
    at: '2025-01-01T00:00:00Z',
    actor: { kind: 'system', id: 'sample', name: 'Sample' },
  }
  await disk.writeAtomic(base.path, bytes('base'), 10)
  await state.put(base)
  let owned = true
  const committing = deferred<void>(),
    release = deferred<void>(),
    put = state.put.bind(state)
  state.put = async (entry) => {
    committing.resolve()
    await release.promise
    if (!owned) throw new Error('old runtime lost')
    await put(entry)
  }
  const placer = (fs: typeof disk) =>
    new PullPlacer(
      { getBlob: async () => bytes('received') },
      fs,
      state,
      { dirty: new Set(), expected: new ExpectedWrites(), filter: { excluded: () => false } },
      sha256
    )
  const oldFs = coordinatedFileSystem(disk, pathCoordinatorOf(host), () => {
    if (!owned) throw new Error('old runtime lost')
  })
  const old = placer(oldFs).place(change, change.sha!, base, new Map(), new Map())
  const rejected = expect(old).rejects.toThrow('old runtime lost')
  await committing.promise
  owned = false
  const nextFs = coordinatedFileSystem(disk, pathCoordinatorOf(host))
  let inspected = false
  const next = pathCoordinatorOf(host).run([base.path], async () => {
    inspected = true
  })
  await Promise.resolve()
  expect(inspected).toBe(false)
  release.resolve()
  await rejected
  await next
  state.put = put
  expect((await state.get(base.path))?.versionId).toBe('base')
  expect(await placer(nextFs).adopt(change, base)).toBe(true)
  expect((await state.get(base.path))?.versionId).toBe('received')
  expect(await placer(nextFs).adopt(change, base)).toBe(false)
})
