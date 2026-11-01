import { expect, it, vi } from 'vitest'
import { MemoryFileSystem, pathAdmission } from '@abele/sync-sdk/core'
import { scopedFileSystem } from '@/sync/scopedFileSystem'
import { PLACEMENT } from '@/sync/pathCoordinator'
import { PRIVATE_PLACEMENT_STAGES } from '@/sync/privatePlacementStages'

const includes = (path: string) => path === 'Shared' || path.startsWith('Shared/')
const assertPath = (path: string) => {
  if (!includes(path)) throw new Error('outside scope')
}

it('forwards readonly scan revisions without granting a path and binds the current scope root', () => {
  const revision = Symbol.for('abele.sync.local-scan-revision-v1')
  let root = 'Shared'
  const disk = Object.assign(new MemoryFileSystem(), {
    [revision]: function () {
      expect(this).toBe(disk)
      return 'sample-revision'
    },
  })
  const fs = scopedFileSystem(disk, assertPath, includes, undefined, () => root)
  const first = Reflect.get(fs, revision)()
  root = 'Other'
  expect(Reflect.get(fs, revision)()).not.toBe(first)
  expect(
    Reflect.get(scopedFileSystem(new MemoryFileSystem(), assertPath, includes), revision)
  ).toBeUndefined()
})

it('permits cleanup of an owned opaque stage but refuses foreign cleanup', async () => {
  const discardStage = vi.fn(async () => {})
  const disk = Object.assign(new MemoryFileSystem(), { discardStage })
  const fs = scopedFileSystem(disk, assertPath, includes)
  await fs.discardStage('Shared/sample.tmp')
  await expect(async () => fs.discardStage('Private/sample.tmp')).rejects.toThrow('outside scope')
  expect(discardStage).toHaveBeenCalledExactlyOnceWith('Shared/sample.tmp')
})

it.each(['abele.sync.inventory-pass-v1', 'abele.sync.operation-pass-v1'])(
  'delegates %s without widening scoped access',
  async (name) => {
    const pass = Symbol.for(name)
    const directories = Symbol.for('abele.sync.inventory-directories-v1')
    const disk = Object.assign(new MemoryFileSystem(), {
      [pass]: async (work: () => Promise<unknown>) => work(),
      [directories]: async () => [{ path: 'Shared' }, { path: 'Private' }],
    })
    const fs = scopedFileSystem(disk, assertPath, includes)
    expect(await Reflect.get(fs, pass)(async () => 42)).toBe(42)
    await expect(Reflect.get(fs, pass)(() => fs.read('Private/sample.md'))).rejects.toThrow(
      'outside scope'
    )
    expect(await Reflect.get(fs, directories)()).toEqual([{ path: 'Shared' }])
  }
)

it.each([
  'abele.sync.fingerprint-pull-v1',
  'abele.sync.fingerprint-fresh-v1',
  'abele.sync.reopen-pull-stage-v1',
  'abele.sync.live-source-stage-v1',
])('checks paths for the pull capability %s', async (name) => {
  const called = vi.fn(async () => ({}))
  const key = Symbol.for(name)
  const disk = Object.assign(new MemoryFileSystem(), { [key]: called })
  const fs = scopedFileSystem(disk, assertPath, includes)
  await expect(async () => Reflect.get(fs, key)('Private/secret.md')).rejects.toThrow(
    'outside scope'
  )
  expect(called).not.toHaveBeenCalled()
  await Reflect.get(fs, key)('Shared/sample.md')
  expect(called).toHaveBeenCalledOnce()
})

it('validates both publication recovery paths before delegating', async () => {
  const key = Symbol.for('abele.sync.recover-published-pull-v1')
  const called = vi.fn(async () => ({}))
  const disk = Object.assign(new MemoryFileSystem(), { [key]: called })
  const fs = scopedFileSystem(disk, assertPath, includes)
  for (const args of [
    [null, 'Private/secret.md', 0, null],
    [null, 'Shared/sample.md', 0, 'Private/secret.md'],
    ['Private/secret.tmp', 'Shared/sample.md', 0, null],
  ])
    await expect(async () => Reflect.get(fs, key)(...args)).rejects.toThrow('outside scope')
  expect(called).not.toHaveBeenCalled()
  await Reflect.get(fs, key)('Shared/sample.tmp', 'Shared/sample.md', 0, null)
  expect(called).toHaveBeenCalledOnce()
})

it.each(['abele.sync.diagnostic-v1', 'abele.sync.replay-stage-v1'])(
  'delegates the path-free capability %s',
  (name) => {
    const key = Symbol.for(name),
      called = vi.fn()
    const disk = Object.assign(new MemoryFileSystem(), { [key]: called })
    Reflect.get(scopedFileSystem(disk, assertPath, includes), key)()
    expect(called).toHaveBeenCalledOnce()
  }
)

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

it('preserves synchronous scoped path admission and its receiver', () => {
  const disk = new MemoryFileSystem()
  const admission = vi.fn(function (this: MemoryFileSystem, path: string) {
    expect(this).toBe(disk)
    return { allowed: false as const, reason: 'unsupported-host-name: ' + path }
  })
  Object.assign(disk, { [pathAdmission]: admission })
  const fs = scopedFileSystem(disk, assertPath, includes)
  expect(fs[pathAdmission]!('Shared/sample:part.md')).toEqual({
    allowed: false,
    reason: 'unsupported-host-name: Shared/sample:part.md',
  })
  expect(() => fs[pathAdmission]!('Private/sample.md')).toThrow('outside scope')
  expect(admission).toHaveBeenCalledTimes(1)
})

it('refuses a conditional capture whose private destination escapes the connection', async () => {
  const conditionalFile = vi.fn(async () => true)
  const disk = Object.assign(new MemoryFileSystem(), {
    conditionalCapture: true as const,
    conditionalFile,
  })
  const fs = scopedFileSystem(disk, assertPath, includes)
  expect(fs.conditionalCapture).toBe(true)
  await expect(async () =>
    fs.conditionalFile!({
      path: 'Shared/sample.md',
      expected: null,
      effect: { kind: 'remove', retainAt: 'Private/capture' },
    })
  ).rejects.toThrow('outside scope')
  expect(conditionalFile).not.toHaveBeenCalled()
})

it('checks a scope ancestor without enumerating unrelated directories', async () => {
  const inventory = Symbol.for('abele.sync.inventory-directories-v1')
  const children = Symbol.for('abele.sync.inventory-children-v1')
  const read = vi.fn(async () => [{ path: 'Shared' }])
  const disk = Object.assign(new MemoryFileSystem(), {
    [inventory]: read,
    [Symbol.for('abele.sync.inventory-directory-v1')]: async (path: string) => {
      expect(path).toBe('Shared')
      return { path, kind: 'directory' }
    },
    [children]: async () => [],
  })
  const fs = scopedFileSystem(disk, assertPath, includes, undefined, 'Shared')
  for (let i = 0; i < 2048; i++)
    expect(await Reflect.get(fs, children)('', `Shared/Folder${i}/sample.bin`)).toEqual([
      { path: 'Shared', kind: 'directory' },
    ])
  expect(read).not.toHaveBeenCalled()
})
