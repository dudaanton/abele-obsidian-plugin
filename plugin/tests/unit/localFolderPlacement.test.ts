import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { MemoryFileSystem } from '@abele/sync-sdk/core'
import { LocalFolderPlacement, placementMethods } from '@/sync/localFolderPlacement'
import { PRIVATE_PLACEMENT_STAGES } from '@/sync/privatePlacementStages'
import { PLACEMENT } from '@/sync/pathCoordinator'

it.each(['Private/secret.md', 'Shared-other/secret.md', 'Shared/../Private/secret.md'])(
  'refuses paths outside the server scope before touching the filesystem: %s',
  async (path) => {
    const placement = new LocalFolderPlacement('Shared', 'Moved')
    expect(() => placement.toLocal(path)).toThrow()
    const disk = new MemoryFileSystem(),
      read = vi.spyOn(disk, 'read')
    await expect(placement.fileSystem(disk).read(path)).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
  }
)

it('refuses outgoing local paths outside the pinned placement', () => {
  expect(() => new LocalFolderPlacement('Shared', 'Moved').toServer('Private/secret.md')).toThrow()
})

it('maps filesystem paths, watcher batches and placement leases without changing identities', async () => {
  const disk = new MemoryFileSystem(),
    placement = new LocalFolderPlacement('Shared', 'Moved')
  await disk.writeAtomic('Moved/sample.md', new TextEncoder().encode('sample'), 1000)
  await disk.writeAtomic('Private/secret.md', new TextEncoder().encode('private'), 1000)
  const lease = vi.fn(async (_paths: string[], work: () => Promise<unknown>) => work())
  Object.assign(disk, { [PLACEMENT]: lease })
  const fs = placement.fileSystem(disk),
    notified = vi.fn(),
    stop = fs.watch!(notified)
  try {
    expect(await Array.fromAsync(fs.list())).toEqual([
      { path: 'Shared/sample.md', size: 6, mtime: 1000 },
    ])
    expect(await fs.stat('Shared/sample.md')).toMatchObject({ path: 'Shared/sample.md', size: 6 })
    disk.emitChange(['Moved/sample.md', 'Private/secret.md'])
    expect(notified).toHaveBeenLastCalledWith(['Shared/sample.md'])
    await Reflect.get(fs, PLACEMENT)(['Shared/sample.md'], async () => {})
    expect(lease.mock.calls[0][0]).toEqual(['Moved/sample.md'])
    await fs.move('Shared/sample.md', 'Shared/renamed.md')
    expect(await disk.stat('Moved/renamed.md')).not.toBeNull()
  } finally {
    stop()
  }
})

it('maps streaming destinations and leaves opaque stage identities unchanged', async () => {
  const disk = new MemoryFileSystem(),
    stage = { id: 'opaque-stage' },
    beginAtomicWrite = vi.fn(async () => stage),
    reopenStage = vi.fn(async () => stage)
  Object.assign(disk, { beginAtomicWrite, reopenStage })
  const fs = new LocalFolderPlacement('Shared', 'Moved').fileSystem(disk)
  expect(await fs.beginAtomicWrite!('Shared/sample.bin', 1000, null)).toBe(stage)
  expect(beginAtomicWrite).toHaveBeenCalledWith('Moved/sample.bin', 1000, null)
  expect(await fs.reopenStage!('opaque-stage')).toBe(stage)
  expect(reopenStage).toHaveBeenCalledWith('opaque-stage')
})

it('maps bounded representation reads to the placed file', async () => {
  const disk = new MemoryFileSystem()
  const readPrefix = vi.fn(async (path: string) => new TextEncoder().encode(path))
  Object.assign(disk, { readPrefix })
  const fs = new LocalFolderPlacement('Shared', 'Moved').fileSystem(disk)
  const bytes = await Reflect.get(fs, 'readPrefix')('Shared/sample.md', 64)
  expect(new TextDecoder().decode(bytes)).toBe('Moved/sample.md')
  expect(readPrefix).toHaveBeenCalledWith('Moved/sample.md', 64)
})

it('assigns a placement policy to every filesystem interface method', () => {
  const methods = ['fs', 'streaming'].flatMap((file) => {
    const text = readFileSync(`node_modules/@abele/sync-sdk/dist/internal/core/${file}.d.ts`, 'utf8')
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest)
    return ast.statements.flatMap((node) =>
      ts.isInterfaceDeclaration(node) &&
      ['FileSystem', 'StreamingFileSystem'].includes(node.name.text)
        ? node.members.map((member) => member.name!.getText(ast))
        : []
    )
  })
  expect(Object.keys(placementMethods).sort()).toEqual([...methods, 'readPrefix'].sort())
  const disk = Object.assign(new MemoryFileSystem(), { futureRead: async () => new Uint8Array() })
  const fs = new LocalFolderPlacement('Shared', 'Moved').fileSystem(disk)
  expect(() => Reflect.get(fs, 'futureRead')).toThrow(/no placement policy/)
})

it.each(
  Object.entries(placementMethods).filter(([, policy]) => policy === 'path' || policy === 'pair')
)('refuses foreign paths before filesystem entry point %s', async (method, policy) => {
  const called = vi.fn()
  const disk = new Proxy(new MemoryFileSystem(), { get: () => called })
  const fs = new LocalFolderPlacement('Shared', 'Moved').fileSystem(disk)
  for (const args of policy === 'pair'
    ? [
        ['Private/secret.md', 'Shared/sample.md'],
        ['Shared/sample.md', 'Private/secret.md'],
      ]
    : [['Private/secret.md']]) {
    await expect(async () => Reflect.get(fs, method)(...args)).rejects.toThrow()
    expect(called).not.toHaveBeenCalled()
  }
})

it('keeps private placement scratch separate from all server path operations', async () => {
  const disk = new MemoryFileSystem()
  const fs = new LocalFolderPlacement('Shared', 'Moved').fileSystem(disk)
  const stages = Reflect.get(fs, PRIVATE_PLACEMENT_STAGES)
  const path = '.abele-sync/placement-outbox/' + 'a'.repeat(64) + '/' + 'b'.repeat(64)
  await expect(async () => stages.read(path)).rejects.toThrow()
  await stages.writeAtomic(path, new Uint8Array([1, 2]), 1000)
  expect(await stages.read(path)).toEqual(new Uint8Array([1, 2]))
  await expect(fs.read(path)).rejects.toThrow(/outside this connection/)
  await expect(stages.writeAtomic('Private/secret.md', new Uint8Array(), 0)).rejects.toThrow()
  await stages.remove(path)
  expect(await disk.stat(path)).toBeNull()
})

it('authorizes only newly allocated source handles and forbids installing private stages', async () => {
  const discard = vi.fn(async () => {}),
    commit = vi.fn(async () => {})
  const disk = Object.assign(new MemoryFileSystem(), {
    beginAtomicWrite: vi.fn(async () => ({ id: 'opaque-source', discard, commit })),
    openRead: vi.fn(async () => 'source'),
  })
  const placement = new LocalFolderPlacement('Shared', 'Moved')
  const fs = placement.fileSystem(disk)
  const stages = Reflect.get(fs, PRIVATE_PLACEMENT_STAGES)
  expect(Reflect.get(placement.localFileSystem(fs), PRIVATE_PLACEMENT_STAGES)).toBe(stages)
  expect(() => stages.openRead('Private/secret.md')).toThrow()
  const source = await stages.beginAtomicWrite('.abele-sync/placement-inbox/aaaaaaaa-bbbb', 0, null)
  expect(await stages.openRead(source.id)).toBe('source')
  expect(() => source.commit()).toThrow(/cannot be installed/)
  expect(commit).not.toHaveBeenCalled()
  await source.discard()
  expect(() => stages.openRead(source.id)).toThrow()
})

it('keeps physical Unicode spellings while refusing a normalized root sibling', async () => {
  const local = 'Cafe\u0301'
  const placement = new LocalFolderPlacement('Shared', local)
  const fs = new MemoryFileSystem()
  const bytes = new TextEncoder().encode('retained')
  await fs.writeAtomic(local + '/Cafe\u0301.md', bytes, 1000)
  expect(placement.toServer(local + '/Cafe\u0301.md')).toBe('Shared/Cafe\u0301.md')
  expect(() => placement.toServer('Café/Café.md')).toThrow()
  expect(await placement.fileSystem(fs).read('Shared/Cafe\u0301.md')).toEqual(bytes)
})
