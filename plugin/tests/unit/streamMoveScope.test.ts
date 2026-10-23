import { expect, it, vi } from 'vitest'
import { MemoryFileSystem } from '@abele/sync-sdk/core'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { scopedFileSystem } from '@/sync/scopedFileSystem'

it('maps both streamed move paths and rejects a source outside the scope', async () => {
  const method = Symbol.for('abele.sync.stream-move-source-v1')
  const move = vi.fn(async () => true)
  const disk = Object.assign(new MemoryFileSystem(), { [method]: move })
  const mapped = new LocalFolderPlacement('Shared', 'Local').fileSystem(disk)
  await Reflect.get(
    mapped,
    method
  )({ path: 'Shared/a.bin', expected: null, effect: { kind: 'move', to: 'Shared/b.bin' } })
  expect(move).toHaveBeenCalledExactlyOnceWith({
    path: 'Local/a.bin',
    expected: null,
    effect: { kind: 'move', to: 'Local/b.bin' },
  })
  const scoped = scopedFileSystem(
    disk,
    (path) => {
      if (!path.startsWith('Local/')) throw new Error('outside')
    },
    (path) => path.startsWith('Local/')
  )
  expect(() =>
    Reflect.get(
      scoped,
      method
    )({ path: 'Other/a.bin', expected: null, effect: { kind: 'move', to: 'Local/b.bin' } })
  ).toThrow()
})
