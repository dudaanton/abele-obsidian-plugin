// @vitest-environment node
import '../helpers/desktopRequire'
import { expect, it, vi } from 'vitest'
import { promises as disk } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { App } from 'obsidian'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { nativeVault } from '../helpers/nativeRestartVault'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { scopedFileSystem } from '@/sync/scopedFileSystem'
import { LocalPaths } from '../../node_modules/@abele/sync-sdk/dist/internal/core/localPaths.js'

async function fixture(paths = ['Notes/Folder/K.md']) {
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-candidates-')))
  await disk.mkdir(join(root, 'Notes/Folder'), { recursive: true })
  const app = nativeVault(root, disk, paths)
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
  const lifetime = new AbortController()
  const files = new ObsidianFileSystem(app as unknown as App, {
    prepareStartupInventory: async () => {},
    indexWaitSignal: () => lifetime.signal,
  })
  return {
    root,
    app,
    files,
    lifetime,
    close: () => {
      lifetime.abort()
      return disk.rm(root, { recursive: true, force: true })
    },
  }
}

it('uses current indexed aliases even before core receives a watcher event', async () => {
  const one = await fixture()
  try {
    const port = one.files.trustedPathCandidates
    expect(port).toBeDefined()
    expect(await port!.lookup('Notes/Folder', 'K.md')).toEqual([
      { path: 'Notes/Folder/K.md', kind: 'file' },
    ])
    // The host index changes without starting any core watcher.
    await one.app.vault.create('Notes/Folder/\u212a.md', 'sample')
    const paths = await LocalPaths.forPath(one.files, 'Notes/Folder/K.md')
    expect(() => paths.resolve('Notes/Folder/K.md', 'file')).toThrow(/collision/)
  } finally {
    await one.close()
  }
})

it('keeps indexed path lookup after startup while content metadata is busy outside inventory', async () => {
  const one = await fixture(Array.from({ length: 2000 }, (_, i) => `Notes/Folder/K-${i}.md`))
  try {
    await one.files.waitForStartupIndex()
    Object.assign(one.app.metadataCache, { isCacheClean: () => false })
    const listings = vi.spyOn(one.files, 'listChildren')
    for (let i = 0; i < 60; i++) {
      const path = `Notes/Folder/K-${i}.md`
      const paths = await LocalPaths.forFile(one.files, path)
      expect(paths.resolve(path, 'file')).toBe(path)
    }
    expect(listings).not.toHaveBeenCalled()
    await one.app.vault.create('Notes/Folder/\u212a-0.md', 'sample')
    const aliases = await LocalPaths.forFile(one.files, 'Notes/Folder/K-0.md')
    expect(() => aliases.resolve('Notes/Folder/K-0.md', 'file')).toThrow(/collision/)
  } finally {
    await one.close()
  }
})

for (const kind of ['file', 'symlink', 'directory'] as const)
  it(`refuses a stale indexed ancestor replaced by a ${kind}`, async () => {
    const one = await fixture()
    try {
      expect(one.files.trustedPathCandidates).toBeDefined()
      await LocalPaths.forPath(one.files, 'Notes/Folder/K.md')
      await disk.rename(join(one.root, 'Notes/Folder'), join(one.root, 'Retained'))
      if (kind === 'file') await disk.writeFile(join(one.root, 'Notes/Folder'), 'sample')
      else if (kind === 'symlink')
        await disk.symlink(join(one.root, 'Retained'), join(one.root, 'Notes/Folder'))
      else await disk.mkdir(join(one.root, 'Notes/Folder'))
      await expect(LocalPaths.forPath(one.files, 'Notes/Folder/K.md')).rejects.toThrow()
    } finally {
      await one.close()
    }
  })

it('returns unsupported for unindexed and hidden parents, preserving fallback', async () => {
  const one = await fixture()
  try {
    expect(one.files.trustedPathCandidates).toBeDefined()
    expect(await one.files.trustedPathCandidates!.lookup('Missing', 'K.md')).toBeUndefined()
    expect(await one.files.trustedPathCandidates!.lookup('.obsidian', 'K.md')).toBeUndefined()
    await disk.mkdir(join(one.root, '.obsidian'))
    await disk.writeFile(join(one.root, '.obsidian/K.md'), 'sample')
    const paths = await LocalPaths.forPath(one.files, '.obsidian/K.md')
    expect(paths.resolve('.obsidian/K.md', 'file')).toBe('.obsidian/K.md')
    const children = await one.files.listChildren!('.obsidian')
    expect(children.some((row) => row.path === '.obsidian/K.md')).toBe(true)
  } finally {
    await one.close()
  }
})

it('maps trusted candidates through different placement roots and a scoped view', async () => {
  const one = await fixture()
  try {
    const placement = new LocalFolderPlacement('Shared', 'Notes')
    const includes = (path: string) => path === 'Notes' || path.startsWith('Notes/')
    const scoped = scopedFileSystem(
      one.files,
      (path) => {
        if (!includes(path)) throw new Error('sample scope refusal')
      },
      includes,
      undefined,
      'Notes'
    )
    const files = placement.fileSystem(scoped)
    expect(files.trustedPathCandidates).toBeDefined()
    expect(await files.trustedPathCandidates!.lookup('Shared/Folder', 'K.md')).toEqual([
      { path: 'Shared/Folder/K.md', kind: 'file' },
    ])
    expect(await files.trustedPathCandidates!.lookup('Elsewhere', 'K.md')).toBeUndefined()
    const paths = await LocalPaths.forPath(files, 'Shared/Folder/K.md')
    expect(paths.resolve('Shared/Folder/K.md', 'file')).toBe('Shared/Folder/K.md')
    await expect(files.trustedPathCandidates!.lstat('Elsewhere/K.md')).rejects.toThrow()
  } finally {
    await one.close()
  }
})

it('builds one folder case map rather than walking its siblings on every lookup', async () => {
  const one = await fixture(Array.from({ length: 2000 }, (_, i) => `Notes/Folder/K ${i}.md`))
  try {
    let visits = 0
    const folder = one.app.vault.getAbstractFileByPath('Notes/Folder') as unknown as {
      children: { path: string }[]
    }
    for (const child of folder.children) {
      const path = child.path
      Object.defineProperty(child, 'path', {
        get: () => {
          visits++
          return path
        },
        configurable: true,
      })
    }
    expect(one.files.trustedPathCandidates).toBeDefined()
    const port = one.files.trustedPathCandidates!
    for (let i = 0; i < 2000; i++)
      expect(await port.lookup('Notes/Folder', `K ${i}.md`)).toHaveLength(1)
    expect(visits).toBeLessThanOrEqual(12000)
    console.log('candidate-map', { files: 2000, visits })
  } finally {
    await one.close()
  }
})

it('updates a wide folder map incrementally on host create, rename and delete', async () => {
  const one = await fixture(Array.from({ length: 2000 }, (_, i) => `Notes/Folder/K ${i}.md`))
  try {
    const folder = one.app.vault.getAbstractFileByPath('Notes/Folder') as unknown as {
      children: { path: string }[]
    }
    let visits = 0
    for (const child of folder.children) {
      const path = child.path
      Object.defineProperty(child, 'path', {
        get: () => {
          visits++
          return path
        },
        configurable: true,
      })
    }
    const port = one.files.trustedPathCandidates!
    expect(await port.lookup('Notes/Folder', 'K 0.md')).toHaveLength(1)
    for (let i = 0; i < 200; i++) {
      const file = await one.app.vault.create(`Notes/Folder/New ${i}.md`, 'sample')
      one.app.emit('vault', 'create', file)
      expect(await port.lookup('Notes/Folder', `New ${i}.md`)).toHaveLength(1)
      await one.app.vault.rename(file, `Notes/Folder/Renamed ${i}.md`)
      one.app.emit('vault', 'rename', file, `Notes/Folder/New ${i}.md`)
      expect(await port.lookup('Notes/Folder', `New ${i}.md`)).toEqual([])
      expect(await port.lookup('Notes/Folder', `Renamed ${i}.md`)).toHaveLength(1)
      await one.app.vault.delete(file)
      one.app.emit('vault', 'delete', file)
      expect(await port.lookup('Notes/Folder', `Renamed ${i}.md`)).toEqual([])
    }
    // Only the first map build may visit the original siblings.
    expect(visits).toBe(2000)
  } finally {
    await one.close()
  }
})

it('lists group occupancy with a busy index without claiming directory ownership', async () => {
  const one = await fixture()
  try {
    await disk.writeFile(join(one.root, 'Notes/Folder/K.md'), 'sample')
    Object.assign(one.app.metadataCache, { isCacheClean: () => false })
    const files = new ObsidianFileSystem(one.app as unknown as App, {
      discovery: { roots: [], includes: () => true },
    })
    expect(await files.listChildren('Notes')).toEqual([
      { path: 'Notes/Folder', kind: 'directory' },
    ])
    expect(await files.listChildren('Notes/Folder')).toEqual([
      { path: 'Notes/Folder/K.md', kind: 'file' },
    ])
  } finally {
    await one.close()
  }
})

it('keeps the portable fallback for groups and adapters without a native no-follow stat', async () => {
  const one = await fixture()
  try {
    for (const [roots, fileScope] of [
      [[], undefined],
      [['Notes'], undefined],
      [[], 'Notes'],
    ] as const) {
      const files = new ObsidianFileSystem(one.app as unknown as App, {
        prepareStartupInventory: async () => {},
        discovery: { roots, includes: () => true },
        fileScope,
      })
      expect(files.trustedPathCandidates).toBeUndefined()
    }
    Reflect.deleteProperty(one.app.vault.adapter, 'fsPromises')
    const portable = new ObsidianFileSystem(one.app as unknown as App, {
      prepareStartupInventory: async () => {},
    })
    expect(portable.trustedPathCandidates).toBeUndefined()
  } finally {
    await one.close()
  }
})

it('checks virtual ancestors for nested scope and placement roots without exposing siblings', async () => {
  const one = await fixture()
  try {
    const includes = (path: string) => path === 'Notes/Folder' || path.startsWith('Notes/Folder/')
    const scope = scopedFileSystem(
      one.files,
      (path) => {
        if (!includes(path)) throw new Error('sample scope refusal')
      },
      includes,
      undefined,
      'Notes/Folder'
    )
    const files = new LocalFolderPlacement('Area/Shared', 'Notes/Folder').fileSystem(scope)
    expect(await files.trustedPathCandidates!.lookup('', 'Other')).toEqual([])
    const paths = await LocalPaths.forPath(files, 'Area/Shared/K.md')
    expect(paths.resolve('Area/Shared/K.md', 'file')).toBe('Area/Shared/K.md')
    const localPaths = await LocalPaths.forPath(scope, 'Notes/Folder/K.md')
    expect(localPaths.resolve('Notes/Folder/K.md', 'file')).toBe('Notes/Folder/K.md')
  } finally {
    await one.close()
  }
})

it('does not recertify a replaced directory when the candidate cache is cold', async () => {
  const one = await fixture()
  try {
    // A previous successful inventory certified the original directory UUID.
    for await (const _ of one.files.listDirectories!()) {
      /* retain */
    }
    await disk.rename(join(one.root, 'Notes/Folder'), join(one.root, 'Retained'))
    await disk.mkdir(join(one.root, 'Notes/Folder'))
    // No host callback: its settled index still names the original folder object.
    await expect(LocalPaths.forPath(one.files, 'Notes/Folder/K.md')).rejects.toThrow(
      /identity changed/
    )
    await expect(LocalPaths.forPath(one.files, 'Notes/Folder/K.md')).rejects.toThrow(
      /identity changed/
    )
  } finally {
    await one.close()
  }
})

it('keeps directory evidence cached when only indexed file membership changes', async () => {
  const one = await fixture()
  try {
    await Reflect.get(one.files, Symbol.for('abele.sync.inventory-pass-v1')).call(
      one.files,
      async () => {
        await LocalPaths.forPath(one.files, 'Notes/Folder/K.md')
        const directories = Reflect.get(one.files, 'directories')
        const reads = vi.spyOn(directories, 'records')
        try {
          for (let i = 0; i < 100; i++) {
            const file = await one.app.vault.create(`Notes/Folder/K ${i}.md`, 'sample')
            one.app.emit('vault', 'create', file)
            await LocalPaths.forPath(one.files, `Notes/Folder/K ${i}.md`)
          }
          expect(reads).toHaveBeenCalledTimes(0)
        } finally {
          reads.mockRestore()
        }
      }
    )
  } finally {
    await one.close()
  }
})

it('keeps saved directory evidence coherent with a rename before the host event arrives', async () => {
  const one = await fixture()
  try {
    await Reflect.get(one.files, Symbol.for('abele.sync.inventory-pass-v1')).call(
      one.files,
      async () => {
        const directories = Reflect.get(one.files, 'directories')
        const identity = await directories.identity('Notes/Folder', true)
        expect(directories.knownIdentity('Notes/Folder')).toBe(identity)
        await disk.rename(join(one.root, 'Notes/Folder'), join(one.root, 'Notes/Moved'))
        directories.renamed('Notes/Folder', 'Notes/Moved')
        expect(directories.knownIdentity('Notes/Folder')).toBeUndefined()
        expect(directories.knownIdentity('Notes/Moved')).toBe(identity)
      }
    )
  } finally {
    await one.close()
  }
})

it('releases host membership observers when their runtime stops', async () => {
  const one = await fixture()
  try {
    const on = vi.spyOn(one.app.vault, 'on')
    const off = vi.spyOn(one.app.vault, 'offref')
    await one.files.trustedPathCandidates!.lookup('Notes/Folder', 'K.md')
    expect(on).toHaveBeenCalledTimes(3)
    one.lifetime.abort()
    expect(off).toHaveBeenCalledTimes(3)
    expect(await one.files.trustedPathCandidates!.lookup('Notes/Folder', 'K.md')).toBeUndefined()
  } finally {
    await one.close()
  }
})

it('uses current folder membership during metadata parsing after the startup index settled', async () => {
  const one = await fixture()
  try {
    await Reflect.get(one.files, Symbol.for('abele.sync.inventory-pass-v1')).call(
      one.files,
      async () => {
        const port = one.files.trustedPathCandidates!
        expect(await port.lookup('Notes/Folder', 'K.md')).toHaveLength(1)
        // The vault tree is current; content metadata parsing is still queued.
        Object.assign(one.app.metadataCache, { isCacheClean: () => false })
        const file = await one.app.vault.create('Notes/Folder/New K.md', 'sample')
        one.app.emit('vault', 'create', file)
        expect(await port.lookup('Notes/Folder', 'New K.md')).toEqual([
          { path: 'Notes/Folder/New K.md', kind: 'file' },
        ])
        const listings = vi.spyOn(one.files, 'listChildren')
        await LocalPaths.forPath(one.files, 'Notes/Folder/New K.md')
        expect(listings).not.toHaveBeenCalled()
      }
    )
  } finally {
    await one.close()
  }
})

it('models native birth time as the same creation time exposed by the host adapter', async () => {
  const app = buildFakeVault([{ path: 'Sample/K.md', ctime: 1234, content: 'sample' }])
  withDesktopFs(app)
  const native = Reflect.get(app.vault.adapter, 'fsPromises')
  expect((await native.lstat('/vault/Sample/K.md')).birthtimeMs).toBe(1234)
  expect((await native.lstat('/vault/Sample')).birthtimeMs).toBe(
    (await app.vault.adapter.stat('Sample'))!.ctime
  )
})

it('keeps scope bootstrap on the fallback until its root is indexed', async () => {
  const one = await fixture()
  try {
    const files = new ObsidianFileSystem(one.app as unknown as App, {
      prepareStartupInventory: async () => {},
      fileScope: 'Fresh/Shared',
    })
    expect(files.trustedPathCandidates).toBeUndefined()
    await one.app.vault.create('Fresh/Shared/K.md', 'sample')
    expect(files.trustedPathCandidates).toBeDefined()
  } finally {
    await one.close()
  }
})

it('retains the physical fallback for a certified folder missing from the current index', async () => {
  const one = await fixture()
  try {
    for await (const _ of one.files.listDirectories!()) {
      /* retain */
    }
    const parent = one.app.vault.getAbstractFileByPath('Notes') as unknown as {
      children: { path: string }[]
    }
    parent.children = parent.children.filter((child) => child.path !== 'Notes/Folder')
    const lookup = one.app.vault.getAbstractFileByPath.bind(one.app.vault)
    one.app.vault.getAbstractFileByPath = (path) => (path === 'Notes/Folder' ? null : lookup(path))
    await Reflect.get(one.files, Symbol.for('abele.sync.inventory-pass-v1')).call(
      one.files,
      async () => {
        expect(await one.files.trustedPathCandidates!.lookup('Notes', 'Folder')).toBeUndefined()
        const paths = await LocalPaths.forPath(one.files, 'Notes/Folder/K.md')
        expect(paths.resolve('Notes/Folder/K.md', 'file')).toBe('Notes/Folder/K.md')
      }
    )
  } finally {
    await one.close()
  }
})

it('refreshes a folder candidate after an indexed delete and recreation in the same pass', async () => {
  const one = await fixture()
  try {
    const pass = Reflect.get(one.files, Symbol.for('abele.sync.inventory-pass-v1')) as <T>(
      work: () => Promise<T>
    ) => Promise<T>
    await pass.call(one.files, async () => {
      const before = await one.files.trustedPathCandidates!.lookup('Notes', 'Folder')
      const folder = one.app.vault.getAbstractFileByPath('Notes/Folder')!
      await disk.rename(join(one.root, 'Notes/Folder'), join(one.root, 'Retained'))
      one.app.emit('vault', 'delete', folder)
      await disk.mkdir(join(one.root, 'Notes/Folder'))
      one.app.emit('vault', 'create', folder)
      const after = await one.files.trustedPathCandidates!.lookup('Notes', 'Folder')
      expect(after?.[0]?.identity).not.toBe(before?.[0]?.identity)
      await expect(LocalPaths.forPath(one.files, 'Notes/Folder/Restored.md')).resolves.toBeDefined()
    })
  } finally {
    await one.close()
  }
})
