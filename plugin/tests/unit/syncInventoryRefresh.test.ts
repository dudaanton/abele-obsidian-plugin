import { expect, it, vi } from 'vitest'
import type { TFolder } from 'obsidian'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import {
  applyStaged,
  ExpectedWrites,
  MemoryStateStore,
  scan,
  sha256,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { CommitOpSchema } from '@abele/sync-sdk/protocol'

it.each([
  ['watch-first', 1234.75],
  ['list-first', 1234.75],
  ['watch-first', 1235],
] as const)(
  'uses integer settings dates through the startup cache, scan and review (%s, %s)',
  async (order, mtime) => {
    vi.useFakeTimers()
    const path = '.obsidian/hotkeys.json'
    const app = buildFakeVault([{ path, content: '{}', mtime }])
    const initial = new Map([[path, { path, size: 2, mtime }]])
    const fs = new ObsidianFileSystem(app as never, {
      startupInventory: () => initial,
      pollMs: 60000,
    })
    let stop: (() => void) | undefined
    try {
      if (order === 'list-first') await Array.fromAsync(fs.list())
      stop = fs.watch(() => {})
      const state = new MemoryStateStore()
      const result = await scan(fs, state, { excluded: () => false })
      const op = result.ops.find((one) => one.op === 'create' && one.path === path)!
      expect(CommitOpSchema.safeParse(op).success).toBe(true)
      const info = result.infos.get(path)!
      expect(info.mtime).toBe(1235)
      expect(info.mtime).toBe((await fs.stat(path))!.mtime)
      expect(initial.get(path)!.mtime).toBe(mtime)
      await state.put({
        path,
        wirePath: path,
        fileId: 'sample-file',
        versionId: 'v1',
        sha: await sha256(new TextEncoder().encode('{}')),
        size: 2,
        mtime: info.mtime,
      })
      expect(await fs.fingerprint(path)).toMatchObject({
        sha: await sha256(new TextEncoder().encode('{}')),
        size: 2,
        mtime: info.mtime,
      })
      const incoming = new TextEncoder().encode('{"sample":true}')
      const messages: string[] = []
      const applied = await applyStaged(
        { getBlob: async () => incoming } as unknown as EngineClient,
        fs,
        state,
        [
          {
            seq: 2,
            file_id: 'sample-file',
            version_id: 'v2',
            op: 'modify',
            path,
            prev_path: null,
            kind: 'settings',
            sha: await sha256(incoming),
            size: incoming.length,
            mtime: 2000,
            actor: { kind: 'token', id: 'sample-peer', name: 'Sample peer' },
            at: new Date(2000).toISOString(),
          },
        ],
        {
          filter: { excluded: () => false },
          dirty: new Set(),
          expected: new ExpectedWrites(),
          log: (line) => messages.push(line),
        }
      )
      expect(applied.applied, messages.join('; ')).toBe(1)
      expect(applied.held).toEqual([])
      expect(await app.vault.adapter.read(path)).toBe('{"sample":true}')
    } finally {
      stop?.()
      vi.useRealTimers()
    }
  }
)

it('reuses startup inventory once and observes later config edits without waiting for the poll', async () => {
  const app = buildFakeVault([{ path: '.obsidian/app.json', content: '{}', mtime: 1 }])
  const initial = new Map([
    ['.obsidian/app.json', { path: '.obsidian/app.json', size: 2, mtime: 1 }],
  ])
  const fs = new ObsidianFileSystem(app as never, { startupInventory: () => initial })
  const collect = async () => {
    const files = []
    for await (const info of fs.list()) files.push(info)
    return files
  }
  expect(await collect()).toContainEqual(initial.get('.obsidian/app.json'))
  await app.vault.adapter.writeBinary(
    '.obsidian/app.json',
    new TextEncoder().encode('{"changed":true}').buffer as ArrayBuffer,
    { mtime: 2 }
  )
  expect(await collect()).toContainEqual({ path: '.obsidian/app.json', size: 16, mtime: 2 })
})

it('does not stat published siblings again after the index observes them during a pull', async () => {
  const app = buildFakeVault([])
  const fs = new ObsidianFileSystem(app as never, { fileScope: 'Container/Shared' })
  const bytes = new TextEncoder().encode('sample')
  const paths = Array.from({ length: 4 }, (_, i) => `Container/Shared/Notes/sample-${i}.md`)
  for (const path of paths) {
    await fs.writeAtomic(path, bytes, 1000)
    await app.vault.createBinary(path, bytes.buffer)
  }
  const lagging = 'Container/Shared/Notes/lagging.md'
  await fs.writeAtomic(lagging, bytes, 1000)
  // The fake adapter indexes synchronously; hide this last child to model watcher lag.
  const parent = app.vault.getAbstractFileByPath('Container/Shared/Notes') as TFolder
  parent.children = parent.children.filter((child) => child.path !== lagging)
  const stat = vi.spyOn(app.vault.adapter, 'stat')
  await fs[Symbol.for('abele.sync.inventory-pass-v1')](async () => {
    const children = await fs[Symbol.for('abele.sync.inventory-children-v1')](
      'Container/Shared/Notes',
      'Container/Shared/Notes/next.md'
    )
    expect(children.filter((one) => one.kind === 'file').map((one) => one.path)).toEqual([
      ...paths,
      lagging,
    ])
    expect(stat.mock.calls.filter(([path]) => paths.includes(path))).toEqual([])
    expect(stat.mock.calls.filter(([path]) => path === lagging)).toHaveLength(1)
  })
})

it.each([false, true])(
  'exposes published parents immediately and batches their identity reads (raw cache=%s)',
  async (rawCache) => {
    const root = 'Container/Shared'
    const app = buildFakeVault([])
    await app.vault.adapter.mkdir(root)
    const fs = new ObsidianFileSystem(app as never, { fileScope: root })
    const parents = [root + '/Fresh', root + '/Fresh/Sub']
    const stat = vi.spyOn(app.vault.adapter, 'stat')
    await fs[Symbol.for('abele.sync.inventory-pass-v1')](async () => {
      await fs[Symbol.for('abele.sync.inventory-directories-v1')]()
      if (rawCache) await fs.listChildren(root)
      stat.mockClear()
      await fs.writeAtomic(parents[1] + '/sample.md', new TextEncoder().encode('sample'), 1000)
      expect(stat.mock.calls.filter(([path]) => parents.includes(path))).toEqual([])
      for (const [parent, child] of [
        [root, parents[0]],
        [parents[0], parents[1]],
      ]) {
        const children = await fs[Symbol.for('abele.sync.inventory-children-v1')](
          parent,
          parents[1] + '/next.md'
        )
        expect(children).toContainEqual(expect.objectContaining({ path: child, kind: 'directory' }))
      }
      // A directory consumer must get real birth identities, never just membership proofs.
      const directories = await fs[Symbol.for('abele.sync.inventory-directories-v1')](true)
      for (const path of parents)
        expect(directories).toContainEqual(
          expect.objectContaining({ path, identity: expect.any(String) })
        )
    })
    const records = app.loadLocalStorage('abele-sync-local-directories-v1') as {
      path: string
      identity: string
    }[]
    for (const path of parents)
      expect(records).toContainEqual(
        expect.objectContaining({ path, identity: expect.any(String) })
      )
  }
)

it.each(['delete', 'rename'] as const)(
  'retires published parent membership on a %s event',
  async (event) => {
    const root = 'Container/Shared'
    const path = root + '/Fresh'
    const app = buildFakeVault([])
    await app.vault.adapter.mkdir(root)
    const fs = new ObsidianFileSystem(app as never, { fileScope: root })
    await fs[Symbol.for('abele.sync.inventory-pass-v1')](async () => {
      await fs[Symbol.for('abele.sync.inventory-directories-v1')]()
      await fs.writeAtomic(path + '/sample.md', new TextEncoder().encode('sample'), 1000)
      if (event === 'rename') {
        await app.vault.rename(app.vault.getAbstractFileByPath(path)!, root + '/Moved')
        app.emit('vault', event, { path: root + '/Moved', children: [] }, path)
      } else {
        await app.vault.adapter.rmdir(path, true)
        app.emit('vault', event, { path, children: [] })
      }
      const children = await fs[Symbol.for('abele.sync.inventory-children-v1')](
        root,
        root + '/next.md'
      )
      expect(children.some((one) => one.path === path)).toBe(false)
      const directories = await fs[Symbol.for('abele.sync.inventory-directories-v1')](true)
      expect(directories.some((one) => one.path === path)).toBe(false)
    })
  }
)

it('retires published parent membership after an engine directory move without a watcher echo', async () => {
  const root = 'Container/Shared'
  const path = root + '/Fresh'
  const app = buildFakeVault([])
  await app.vault.adapter.mkdir(root)
  const rename = app.vault.adapter.rename.bind(app.vault.adapter)
  app.vault.adapter.rename = async (from, to) => {
    const entry = app.vault.getAbstractFileByPath(from)
    if (entry && 'children' in entry) await app.vault.rename(entry, to)
    else await rename(from, to)
  }
  const fs = new ObsidianFileSystem(app as never, { fileScope: root })
  await fs[Symbol.for('abele.sync.inventory-pass-v1')](async () => {
    await fs[Symbol.for('abele.sync.inventory-directories-v1')]()
    await fs.writeAtomic(path + '/sample.md', new TextEncoder().encode('sample'), 1000)
    await fs.moveDirectory(path, root + '/Moved')
    const children = await fs[Symbol.for('abele.sync.inventory-children-v1')](
      root,
      root + '/next.md'
    )
    expect(children.some((one) => one.path === path)).toBe(false)
    expect(children.some((one) => one.path === root + '/Moved')).toBe(true)
  })
})

it.each(['rename-follow', 'delete-restore'])(
  'refreshes batched parent identities after root %s',
  async (action) => {
    let root = 'Container/Shared'
    const app = buildFakeVault([{ path: root + '/kept.md', content: 'kept' }])
    let birth = 1000
    const rawStat = app.vault.adapter.stat.bind(app.vault.adapter)
    vi.spyOn(app.vault.adapter, 'stat').mockImplementation(async (path) => {
      const stat = await rawStat(path)
      return stat?.type === 'folder' ? { ...stat, ctime: birth } : stat
    })
    const fs = new ObsidianFileSystem(app as never, { fileScope: () => root })
    await fs[Symbol.for('abele.sync.inventory-pass-v1')](async () => {
      const before = await fs[Symbol.for('abele.sync.inventory-directories-v1')]()
      const oldRoot = root
      const oldIdentity = before.find((item) => item.path === root)!.identity
      await fs.writeAtomic(root + '/Fresh/sample.md', new TextEncoder().encode('sample'), 1000)
      if (action === 'rename-follow') {
        await app.vault.rename(app.vault.getAbstractFileByPath(root)!, 'Moved/Shared')
        root = 'Moved/Shared'
        app.emit('vault', 'rename', { path: root, children: [] }, oldRoot)
      } else {
        await app.vault.delete(app.vault.getAbstractFileByPath(root)!)
        await app.vault.adapter.rmdir(root, true)
        app.emit('vault', 'delete', { path: root, children: [] })
        birth = 2000
        await app.vault.createFolder(root)
      }
      await fs.writeAtomic(root + '/New/sample.md', new TextEncoder().encode('new sample'), 2000)
      const after = await fs[Symbol.for('abele.sync.inventory-directories-v1')](true)
      expect(after.some((item) => item.path === oldRoot + '/Fresh')).toBe(false)
      expect(after).toContainEqual(
        expect.objectContaining({ path: root + '/New', identity: expect.any(String) })
      )
      if (action === 'rename-follow')
        expect(after.some((item) => item.path === oldRoot)).toBe(false)
      else expect(after.find((item) => item.path === root)!.identity).not.toBe(oldIdentity)
      const children = await fs[Symbol.for('abele.sync.inventory-children-v1')](
        root,
        root + '/next.md'
      )
      expect(children).toContainEqual(
        expect.objectContaining({ path: root + '/New', kind: 'directory' })
      )
    })
  }
)
