import { expect, it, vi } from 'vitest'
import { MemoryFileSystem } from '@abele/sync-core'
import { scopedFileSystem } from '@/sync/scopedFileSystem'
import { PLACEMENT } from '@/sync/pathCoordinator'
import { PRIVATE_PLACEMENT_STAGES } from '@/sync/privatePlacementStages'

const includes = (path: string) => path === 'Shared' || path.startsWith('Shared/')
const assertPath = (path: string) => {
  if (!includes(path)) throw new Error('outside scope')
}

it.each([
  'read',
  'stat',
  'fingerprint',
  'openRead',
  'writeAtomic',
  'beginAtomicWrite',
  'remove',
  'mkdir',
  'removeDirectory',
  'move',
  'moveDirectory',
])('refuses a foreign path before filesystem %s', async (method) => {
  const called = vi.fn()
  const disk = Object.assign(new MemoryFileSystem(), { [method]: called })
  const fs = scopedFileSystem(disk, assertPath, includes)
  await expect(async () =>
    Reflect.get(fs, method)('Private/secret.md', 'Shared/sample.md')
  ).rejects.toThrow('outside scope')
  if (method === 'move' || method === 'moveDirectory')
    await expect(async () =>
      Reflect.get(fs, method)('Shared/sample.md', 'Private/secret.md')
    ).rejects.toThrow('outside scope')
  expect(called).not.toHaveBeenCalled()
})

it('rejects unknown filesystem operations and foreign placement leases', () => {
  const called = vi.fn()
  const disk = Object.assign(new MemoryFileSystem(), { futureRead: called, [PLACEMENT]: called })
  const fs = scopedFileSystem(disk, assertPath, includes)
  expect(() => Reflect.get(fs, 'futureRead')).toThrow('no scope policy')
  expect(() => Reflect.get(fs, PLACEMENT)(['Private/secret.md'], called)).toThrow('outside scope')
  expect(called).not.toHaveBeenCalled()
})

it('filters outgoing inventory and watcher events before handing them to core', async () => {
  const disk = new MemoryFileSystem()
  await disk.writeAtomic('Private/secret.md', new Uint8Array([1]), 0)
  await disk.writeAtomic('Shared/sample.md', new Uint8Array([2]), 0)
  const fs = scopedFileSystem(disk, assertPath, includes)
  const paths: string[] = []
  for await (const file of fs.list()) paths.push(file.path)
  expect(paths).toEqual(['Shared/sample.md'])
  const notify = vi.fn(),
    stop = fs.watch!(notify)
  disk.emitChange(['Private/secret.md', 'Shared/sample.md'])
  expect(notify).toHaveBeenCalledWith(['Shared/sample.md'])
  stop()
})

it('keeps trusted staging separate from paths supplied by the server', async () => {
  const disk = new MemoryFileSystem(),
    fs = scopedFileSystem(disk, assertPath, includes)
  const stages = Reflect.get(fs, PRIVATE_PLACEMENT_STAGES)
  const path = '.abele-sync/placement-outbox/' + 'a'.repeat(64) + '/' + 'b'.repeat(64)
  await expect(async () => stages.read(path)).rejects.toThrow('Unknown private')
  await stages.writeAtomic(path, new Uint8Array([1]), 0)
  expect(await stages.read(path)).toEqual(new Uint8Array([1]))
  await expect(fs.read(path)).rejects.toThrow('outside scope')
  await expect(stages.writeAtomic('Private/secret.md', new Uint8Array(), 0)).rejects.toThrow()
  await stages.remove(path)
  expect(await disk.stat(path)).toBeNull()
})
