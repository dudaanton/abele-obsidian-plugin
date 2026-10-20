// @vitest-environment node
import { desktopFsPort } from '../helpers/desktopRequire'
import { adapterConfigRevision } from '@/sync/adapterConfigChanges'
import {
  guardedVaultAdapter,
  guardedNativeMutation,
  releaseVaultPathGuard,
} from '@/sync/vaultPathLinks'
import { withDesktopFs } from '../helpers/fakeDesktopFs'
import { WriteJournal } from '@/sync/writeJournal'
import { expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { preservePrivateArtifacts, privateRecoveryDirectory } from '@/sync/privateRecovery'
import { stagingDirectory } from '@/sync/stagingDirectory'
import { readIgnore } from '@/sync/scope'
import { buildFakeVault } from '../helpers/fakeVault'
import {
  applyStaged,
  ExpectedWrites,
  MemoryStateStore,
  sha256,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { CommitOpSchema } from '@abele/sync-sdk/protocol'

it('drops disconnected vault guard caches without reviving a retired guard', async () => {
  const base = await fs.mkdtemp(join(tmpdir(), 'sample-guard-lifecycle-'))
  try {
    const root = join(base, 'vault')
    await fs.mkdir(root)
    const { app, disk } = await nativeFixture(root)
    expect(await disk.exists('')).toBe(true)
    await fs.rename(root, root + '-old')
    await fs.mkdir(root)
    await expect(disk.exists('')).rejects.toThrow('Vault root changed')
    releaseVaultPathGuard(app.vault)
    await expect(guardedVaultAdapter(app.vault.adapter).exists('')).resolves.toBe(true)
    await expect(disk.exists('')).rejects.toThrow('Vault root changed')
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
})

it.each(['unlink', 'rmdir', 'rename'] as const)(
  'rechecks parent identities synchronously before native %s',
  async (operation) => {
    const root = await fs.mkdtemp(join(tmpdir(), 'sample-parent-fence-'))
    try {
      const parent = join(root, 'nested')
      await fs.mkdir(parent)
      const call = vi.fn().mockName(operation),
        stop = vi.fn()
      const native = {
        ...fs,
        lstat: async (path: string) => {
          const stat = await fs.lstat(path)
          if (path === parent) {
            await fs.rename(parent, parent + '-old')
            await fs.mkdir(parent)
          }
          return stat
        },
      }
      await expect(
        guardedNativeMutation(native, root, [parent + '/item'], call, stop)
      ).rejects.toThrow('parent identity changed')
      expect(call).not.toHaveBeenCalled()
      expect(stop).toHaveBeenCalledOnce()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  }
)

it('detects parent replacement during a native mutation and stops sync', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'sample-parent-after-'))
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const parent = join(root, 'nested')
    await fs.mkdir(parent)
    const stop = vi.fn()
    await expect(
      guardedNativeMutation(
        fs,
        root,
        [parent + '/item'],
        async () => {
          await fs.rename(parent, parent + '-old')
          await fs.mkdir(parent)
        },
        stop
      )
    ).rejects.toThrow('parent identity changed')
    expect(stop).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalled()
  } finally {
    log.mockRestore()
    await fs.rm(root, { recursive: true, force: true })
  }
})

it('keeps the desktop boundary stopped after a mutation parent is restored', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'sample-parent-stopped-'))
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const parent = join(root, 'nested')
    await fs.mkdir(parent)
    await fs.writeFile(join(parent, 'item'), 'sample')
    const native = {
      ...fs,
      unlink: async (path: string) => {
        await fs.unlink(path)
        await fs.rename(parent, parent + '-old')
        await fs.mkdir(parent)
      },
    }
    const { disk } = await nativeFixture(root, native)
    await expect(disk.remove('nested/item')).rejects.toThrow('parent identity changed')
    await fs.rmdir(parent)
    await fs.rename(parent + '-old', parent)
    await expect(disk.list('nested')).rejects.toThrow('parent identity changed')
  } finally {
    log.mockRestore()
    await fs.rm(root, { recursive: true, force: true })
  }
})

it('never writes through a staging leaf swapped at native open', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'sample-boundary-'))
  try {
    const vault = join(root, 'vault')
    await fs.mkdir(vault)
    const target = join(vault, 'stage.tmp'),
      outside = join(root, 'outside.bin')
    await fs.writeFile(target, '')
    await fs.writeFile(outside, '')
    const app = buildFakeVault([])
    let attempts = 0
    Object.assign(app.vault.adapter, {
      getFullPath: (p: string) => join(vault, p),
      stat: async () => ({ type: 'file', size: 0, mtime: 1, ctime: 1 }),
      fsPromises: {
        ...fs,
        open: async (path: string, flags: Parameters<typeof fs.open>[1]) => {
          attempts++
          await fs.unlink(target)
          await fs.symlink(outside, target)
          return fs.open(path, flags)
        },
      },
    })
    desktopFsPort(Reflect.get(app.vault.adapter, 'fsPromises'))
    const io = new BoundedVaultIo(app.vault.adapter)
    await expect(io.append('stage.tmp', 0, new Uint8Array([42]), 1)).rejects.toThrow()
    expect(attempts).toBe(1)
    expect(await fs.readFile(outside)).toHaveLength(0)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

it('refuses a linked private recovery destination before either rename', async () => {
  const app = buildFakeVault([
    { path: '.obsidian/plugins/abele/sync-staging/sample.tmp', content: 'retained' },
  ])
  const recovery = privateRecoveryDirectory(app.vault.configDir)
  Object.assign(app.vault.adapter, {
    getFullPath: (p: string) => p,
    fsPromises: {
      lstat: async (p: string) => ({ isSymbolicLink: () => p === recovery }),
    },
  })
  const rename = vi.spyOn(app.vault.adapter, 'rename')
  await expect(
    preservePrivateArtifacts(app as never, [stagingDirectory(app.vault.configDir) + '/sample.tmp'])
  ).rejects.toThrow(/symbolic link/i)
  expect(rename).not.toHaveBeenCalled()
})

it.each(['ledger', 'config'])('refuses linked descendants during %s discovery', async (kind) => {
  const path = kind === 'ledger' ? 'Shared/nested' : '.obsidian/plugins/linked'
  const app = buildFakeVault([{ path: path + '/sample.md', content: 'external' }])
  Object.assign(app.vault.adapter, {
    getFullPath: (p: string) => p,
    fsPromises: {
      lstat: async (p: string) => ({ isSymbolicLink: () => p === path }),
    },
  })
  const list = vi.spyOn(app.vault.adapter, 'list')
  const disk = new ObsidianFileSystem(app as never)
  const work =
    kind === 'ledger'
      ? Reflect.get(disk, 'spellingOnDisk').call(disk, path + '/sample.md', new Map())
      : Array.fromAsync(Reflect.get(disk, 'walkConfig').call(disk, '.obsidian'))
  await expect(work).rejects.toThrow()
  expect(list.mock.calls.some(([p]) => p === path)).toBe(false)
})

it('refuses a linked ignore file before reading it', async () => {
  const app = buildFakeVault([{ path: '.abele-sync-ignore', content: 'external' }])
  Object.assign(app.vault.adapter, {
    getFullPath: (p: string) => p,
    fsPromises: {
      lstat: async (p: string) => ({ isSymbolicLink: () => p === '.abele-sync-ignore' }),
    },
  })
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  await expect(readIgnore(app as never)).rejects.toThrow(/symbolic link/i)
  expect(read).not.toHaveBeenCalled()
})

it('closes a native handle if a parent is swapped during open before any bytes are read', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'sample-parent-'))
  try {
    const vault = join(root, 'vault'),
      parent = join(vault, 'Shared'),
      outside = join(root, 'outside')
    await fs.mkdir(parent, { recursive: true })
    await fs.mkdir(outside)
    await fs.writeFile(join(parent, 'sample.md'), 'local')
    await fs.writeFile(join(outside, 'sample.md'), 'external')
    const app = buildFakeVault([])
    const close = vi.fn()
    const read = vi.fn()
    Object.assign(app.vault.adapter, {
      getFullPath: (p: string) => join(vault, p),
      stat: async () => ({ type: 'file', size: 5, mtime: 1, ctime: 1 }),
      fsPromises: {
        ...fs,
        open: async (path: string, flags: Parameters<typeof fs.open>[1]) => {
          await fs.rename(parent, parent + '-saved')
          await fs.symlink(outside, parent)
          const handle = await fs.open(path, flags)
          return {
            stat: () => handle.stat(),
            close: async () => {
              close()
              await handle.close()
            },
            read,
          }
        },
      },
    })
    desktopFsPort(Reflect.get(app.vault.adapter, 'fsPromises'))
    await expect(
      new BoundedVaultIo(app.vault.adapter).openRead('Shared/sample.md')
    ).rejects.toThrow(/identity|symbolic link/)
    expect(close).toHaveBeenCalledOnce()
    expect(read).not.toHaveBeenCalled()
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

it.each(['read', 'fingerprint', 'openRead'])(
  'checks an indexed file after its parent becomes linked before %s',
  async (action) => {
    const path = 'Shared/nested/sample.md'
    const app = buildFakeVault([{ path, content: 'indexed' }])
    let linked = false
    const open = vi.fn(async () => {
      throw new Error('external open')
    })
    Object.assign(app.vault.adapter, {
      getFullPath: (p: string) => '/vault/' + p,
      fsPromises: {
        open,
        lstat: async (p: string) => ({
          isSymbolicLink: () => linked && p === '/vault/Shared/nested',
        }),
      },
    })
    const disk = new ObsidianFileSystem(app as never)
    expect((await Array.fromAsync(disk.list())).some((file) => file.path === path)).toBe(true)
    expect(app.vault.getFileByPath(path)).not.toBeNull()
    linked = true
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    await expect(
      action === 'read'
        ? disk.read(path)
        : action === 'fingerprint'
          ? disk.fingerprint(path)
          : disk.openRead(path)
    ).rejects.toThrow(/symbolic link/i)
    expect(read).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  }
)

it.each(['create', 'reopen', 'read', 'seal', 'discard'])(
  'refuses linked private staging during %s without touching its contents',
  async (action) => {
    const app = buildFakeVault([{ path: 'Notes/seed.md', content: 'local' }])
    withDesktopFs(app)
    const root = stagingDirectory(app.vault.configDir)
    const native = Reflect.get(app.vault.adapter, 'fsPromises')
    const lstat = native.lstat.bind(native)
    let linked = false
    native.lstat = async (path: string) =>
      linked && path === '/vault/' + root
        ? { dev: 2, ino: 2, isSymbolicLink: () => true, isDirectory: () => false }
        : lstat(path)
    const disk = new ObsidianFileSystem(app as never)
    const stage =
      action === 'create' ? undefined : await disk.beginAtomicWrite('Notes/pulled.md', 1000, null)
    if (stage) await stage.append(0, new Uint8Array([42]))
    const before = new WriteJournal(app).entries()
    linked = true
    const open = vi.spyOn(native, 'open')
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    const write = vi.spyOn(app.vault.adapter, 'writeBinary')
    const remove = vi.spyOn(app.vault.adapter, 'remove')
    const work =
      action === 'create'
        ? disk.beginAtomicWrite('Notes/pulled.md', 1000, null)
        : action === 'reopen'
          ? disk.reopenStage(stage!.id)
          : action === 'read'
            ? disk.openRead(stage!.id)
            : action === 'seal'
              ? stage!.seal({ size: 1, sha: 'a'.repeat(64) })
              : stage!.discard()
    await expect(work).rejects.toThrow(/symbolic link|cannot stat/i)
    expect(open).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(new WriteJournal(app).entries()).toEqual(before)
  }
)

async function nativeFixture(root: string, native = fs) {
  const app = buildFakeVault([])
  const adapter = app.vault.adapter
  Object.assign(adapter, {
    getFullPath: (p: string) => join(root, p),
    fsPromises: native,
    stat: async (p: string) => {
      try {
        const st = await fs.stat(join(root, p))
        return {
          type: st.isDirectory() ? 'folder' : 'file',
          size: st.size,
          ctime: st.ctimeMs,
          mtime: st.mtimeMs,
        }
      } catch (e) {
        if ((e as { code?: string }).code === 'ENOENT') return null
        throw e
      }
    },
    readBinary: async (p: string) => Uint8Array.from(await fs.readFile(join(root, p))).buffer,
  })
  return { app, adapter, disk: guardedVaultAdapter(adapter) }
}

it('uses the same integer timestamp for native settings stat and fingerprint', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'sample-settings-time-'))
  try {
    const path = '.obsidian/hotkeys.json'
    await fs.mkdir(join(root, '.obsidian'))
    await fs.writeFile(join(root, path), '{}')
    await fs.utimes(join(root, path), 1700000000, 1700000000.1231)
    const raw = await fs.stat(join(root, path))
    expect(Number.isInteger(raw.mtimeMs)).toBe(false)
    const { app } = await nativeFixture(root)
    const disk = new ObsidianFileSystem(app as never)
    const identity = await disk.fingerprint(path)
    const stat = await disk.stat(path)
    expect(identity.mtime).toBe(stat!.mtime)
    expect(Number.isSafeInteger(identity.mtime)).toBe(true)
    expect(identity.mtime).toBe(Math.round(raw.mtimeMs))
    expect(
      CommitOpSchema.safeParse({
        op: 'create',
        path,
        kind: 'settings',
        sha: identity.sha,
        size: identity.size,
        mtime: identity.mtime,
      }).success
    ).toBe(true)
    // Integer wire dates must not weaken the source's sub-millisecond race check.
    const source = await disk.openRead(path)
    try {
      await fs.utimes(join(root, path), 1700000000, 1700000000.1233)
      expect(Math.round((await fs.stat(join(root, path))).mtimeMs)).toBe(stat!.mtime)
      await expect(source.assertUnchanged()).rejects.toThrow(/changed/i)
    } finally {
      await source.close()
    }
    await fs.utimes(join(root, path), 1700000000, 1700000000.1231)
    const state = new MemoryStateStore()
    await state.put({
      path,
      wirePath: path,
      fileId: 'sample-file',
      versionId: 'v1',
      sha: identity.sha,
      size: identity.size,
      mtime: identity.mtime,
    })
    const incoming = new TextEncoder().encode('{"sample":true}')
    const report = await applyStaged(
      { getBlob: async () => incoming } as unknown as EngineClient,
      disk,
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
          mtime: 1700000001000,
          actor: { kind: 'token', id: 'sample-peer', name: 'Sample peer' },
          at: new Date(1700000001000).toISOString(),
        },
      ],
      {
        filter: { excluded: () => false },
        dirty: new Set(),
        expected: new ExpectedWrites(),
        log: () => {},
      }
    )
    expect(report.applied).toBe(1)
    expect(report.held).toEqual([])
    expect(await fs.readFile(join(root, path), 'utf8')).toBe('{"sample":true}')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
it.each(['link', 'directory'])(
  'pins a legitimate vault root and refuses a changed %s identity',
  async (kind) => {
    const base = await fs.mkdtemp(join(tmpdir(), 'sample-root-'))
    try {
      const real = join(base, 'real'),
        other = join(base, 'other'),
        root = join(base, 'vault')
      await fs.mkdir(real)
      await fs.mkdir(other)
      await fs.writeFile(join(real, 'sample.md'), 'local')
      await fs.writeFile(join(other, 'sample.md'), 'external')
      if (kind === 'link') await fs.symlink(real, root)
      else {
        await fs.mkdir(root)
        await fs.writeFile(join(root, 'sample.md'), 'local')
      }
      const { app, disk } = await nativeFixture(root)
      expect(new TextDecoder().decode(await disk.readBinary('sample.md'))).toBe('local')
      // Streaming must also accept a stable linked root.
      expect((await new BoundedVaultIo(app.vault.adapter).fingerprint('sample.md')).size).toBe(5)
      if (kind === 'link') {
        await fs.unlink(root)
        await fs.symlink(other, root)
      } else {
        await fs.rename(root, root + '-saved')
        await fs.mkdir(root)
        await fs.writeFile(join(root, 'sample.md'), 'external')
      }
      await expect(disk.readBinary('sample.md')).rejects.toThrow(/vault root.*changed/i)
      await expect(disk.writeBinary('sample.md', new Uint8Array([42]).buffer)).rejects.toThrow(
        /vault root.*changed/i
      )
      expect(await fs.readFile(join(root, 'sample.md'), 'utf8')).toBe('external')
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  }
)
it.each(['readBinary', 'writeBinary', 'rename', 'remove'])(
  'desktop %s never enters a queued raw adapter syscall',
  async (action) => {
    const base = await fs.mkdtemp(join(tmpdir(), 'sample-queued-'))
    try {
      await fs.writeFile(join(base, 'sample.md'), 'local')
      const { adapter, disk } = await nativeFixture(base)
      const raw = vi.spyOn(adapter, action as 'readBinary').mockImplementation(async () => {
        throw new Error('queued raw adapter bypass')
      })
      if (action === 'readBinary')
        expect(new TextDecoder().decode(await disk.readBinary('sample.md'))).toBe('local')
      else if (action === 'writeBinary') {
        await disk.writeBinary('sample.md', new TextEncoder().encode('edit').buffer)
        expect(await fs.readFile(join(base, 'sample.md'), 'utf8')).toBe('edit')
      } else if (action === 'rename') {
        await disk.rename('sample.md', 'moved.md')
        expect(await fs.readFile(join(base, 'moved.md'), 'utf8')).toBe('local')
      } else {
        await disk.remove('sample.md')
        await expect(fs.stat(join(base, 'sample.md'))).rejects.toMatchObject({ code: 'ENOENT' })
      }
      expect(raw).not.toHaveBeenCalled()
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  }
)

it('keeps config revision observation when native writes bypass raw adapter methods', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'sample-config-'))
  try {
    await fs.mkdir(join(root, '.obsidian'))
    const { disk } = await nativeFixture(root)
    const revision = adapterConfigRevision(disk, '.obsidian'),
      before = revision()
    await disk.writeBinary('.obsidian/sample.json', new TextEncoder().encode('{}').buffer)
    expect(revision()).toBeGreaterThan(before)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

it('keeps directory creation identity stable while native child writes change metadata', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'sample-birth-'))
  try {
    await fs.mkdir(join(root, 'Shared'))
    const { disk } = await nativeFixture(root)
    const before = (await fs.stat(join(root, 'Shared'))).birthtimeMs
    await disk.writeBinary('Shared/sample.md', new Uint8Array([42]).buffer)
    await fs.utimes(join(root, 'Shared'), Date.now() / 1000 + 3600, Date.now() / 1000 + 3600)
    expect((await disk.stat('Shared'))?.ctime).toBe(before)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
