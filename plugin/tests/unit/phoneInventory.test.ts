import { expect, it, vi } from 'vitest'
import { projectionEvidence, EXTERNAL_INSPECTION_KEY } from '@/sync/external/pluginSafety'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { tokenHostFixture } from '../helpers/tokenHostFixture'

it('normalizes fractional inventory timestamps exactly like a fresh config listing', async () => {
  const app = buildFakeVault([{ path: '.obsidian/app.json', content: '{}' }])
  const info = { path: '.obsidian/app.json', size: 2, mtime: 1234.75 }
  const fs = new ObsidianFileSystem(app as never, {
    startupInventory: () => new Map([[info.path, info]]),
  })
  const files = []
  for await (const file of fs.list()) files.push(file)
  expect(files.find((file) => file.path === info.path)?.mtime).toBe(1235)
})

it('settles first sync on a warm 12k-file vault without reading unrelated content', async () => {
  const scope = { kind: 'folder', id: 'sample-root', path: '/' }
  const transport = vi.fn<typeof fetch>(async (input) =>
    new URL(String(input)).pathname === '/v2/connection'
      ? Response.json({
          protocol: 2,
          token_id: 'sample-token',
          space_id: 'sample-space',
          scope,
          status: 'active',
          limits: { max_file_bytes: 1000000, quota_bytes: null },
        })
      : Response.json({ items: [], cursor: 1, next: null })
  )
  const { app, host, ui, id, registry } = tokenHostFixture(
    transport,
    Array.from({ length: 12000 }, (_, i) => ({ path: `Notes/${i}.md`, content: 'ordinary' }))
  )
  await app.vault.adapter.write('.abele-sync-ignore', '*\n!Shared/**\n')
  app.saveLocalStorage(EXTERNAL_INSPECTION_KEY, {
    schema: 1,
    entries: app.vault.getFiles().map((file) => ({
      path: file.path,
      size: file.stat.size,
      mtime: file.stat.mtime,
      marker: false,
    })),
  })
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  const stat = vi.spyOn(app.vault.adapter, 'stat')
  try {
    host.start()
    // The deadlines only bound a hang; the reads, stats and requests below are what prove
    // the warm path, so a loaded machine scanning 12k files slowly does not read as a failure.
    await vi.waitFor(
      () => expect(ui.runtimes.get(id)?.scanSnapshot?.().firstSync.complete).toBe(true),
      { timeout: 30_000 }
    )
    await vi.waitFor(() => expect(registry.records()[0].status).toBe('idle'), { timeout: 10_000 })
    expect(read.mock.calls.filter(([path]) => path.startsWith('Notes/')).length).toBe(0)
    expect(stat.mock.calls.filter(([path]) => path.startsWith('Notes/')).length).toBe(0)
    expect(transport.mock.calls.length).toBeLessThan(20)
  } finally {
    await host.close()
  }
}, 60_000)

it('uses indexed stats for a warm 12k-file inspection and local scan', async () => {
  const app = buildFakeVault(
    Array.from({ length: 12000 }, (_, i) => ({ path: `Notes/${i}.md`, content: 'note' }))
  )
  app.saveLocalStorage(EXTERNAL_INSPECTION_KEY, {
    schema: 1,
    entries: app.vault.getFiles().map((file) => ({
      path: file.path,
      size: file.stat.size,
      mtime: file.stat.mtime,
      marker: false,
    })),
  })
  const stat = vi.spyOn(app.vault.adapter, 'stat')
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  const save = vi.spyOn(app, 'saveLocalStorage')
  await projectionEvidence(app as never)
  const fs = new ObsidianFileSystem(app as never)
  for (const file of app.vault.getFiles()) await fs.stat(file.path)
  expect(stat.mock.calls.filter(([path]) => path.startsWith('Notes/'))).toHaveLength(0)
  expect(read).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})

it('reuses inspection inventory for the first and fallback local listings', async () => {
  const app = buildFakeVault([
    ...Array.from({ length: 12000 }, (_, i) => ({ path: `Notes/${i}.md`, content: 'note' })),
    { path: '.obsidian/app.json', content: '{}' },
  ])
  let inventory: ReadonlyMap<string, { path: string; size: number; mtime: number }> | undefined
  await projectionEvidence(app as never, () => {}, true, new Set(), {
    inventory: (files) => {
      inventory = files
    },
  })
  const list = vi.spyOn(app.vault.adapter, 'list')
  const stat = vi.spyOn(app.vault.adapter, 'stat')
  const fs = new ObsidianFileSystem(app as never, { startupInventory: () => inventory })
  for (let scan = 0; scan < 3; scan++) {
    const files = []
    for await (const file of fs.list()) files.push(file)
    expect(files).toHaveLength(12001)
  }
  expect(list).not.toHaveBeenCalled()
  expect(stat).not.toHaveBeenCalled()
})

it.each([undefined, ['Alias/Shared'], ['Moved/Shared']])(
  'refuses linked ancestors before startup inspection (roots=%s)',
  async (roots) => {
    const root = roots?.[0] ?? 'Alias/Shared'
    const app = buildFakeVault([{ path: root + '/sample.md', content: 'external' }])
    const linked = root.split('/')[0]
    Object.assign(app.vault.adapter, {
      getFullPath: (p: string) => p,
      fsPromises: { lstat: async (p: string) => ({ isSymbolicLink: () => p === linked }) },
    })
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    const list = vi.spyOn(app.vault.adapter, 'list')
    await expect(
      projectionEvidence(app as never, () => {}, true, new Set(), { roots })
    ).rejects.toThrow(/symbolic link/i)
    expect(read).not.toHaveBeenCalled()
    expect(list.mock.calls.some(([p]) => p === root)).toBe(false)
  }
)

it('validates a cached explicit candidate before trusting indexed metadata', async () => {
  const app = buildFakeVault([{ path: 'Alias/Shared/sample.md', content: 'external' }])
  const file = app.vault.getFiles()[0]
  app.saveLocalStorage(EXTERNAL_INSPECTION_KEY, {
    schema: 1,
    entries: [{ path: file.path, size: file.stat.size, mtime: file.stat.mtime, marker: false }],
  })
  Object.assign(app.vault.adapter, {
    getFullPath: (p: string) => p,
    fsPromises: { lstat: async (p: string) => ({ isSymbolicLink: () => p === 'Alias' }) },
  })
  await expect(
    projectionEvidence(app as never, () => {}, true, new Set(), { roots: [], paths: [file.path] })
  ).rejects.toThrow(/symbolic link/i)
})

it('refuses linked staging before orphan recovery inventories private work', async () => {
  const { recoverOrphanPrivateArtifacts } = await import('@/sync/external/pluginSafety')
  const { stagingDirectory } = await import('@/sync/stagingDirectory')
  const { IDBFactory } = await import('fake-indexeddb')
  const app = buildFakeVault([
    { path: '.obsidian/plugins/abele/sync-staging/sample.tmp', content: 'external' },
  ])
  const root = stagingDirectory(app.vault.configDir)
  Object.assign(app.vault.adapter, {
    getFullPath: (p: string) => p,
    fsPromises: { lstat: async (p: string) => ({ isSymbolicLink: () => p === root }) },
  })
  const list = vi.spyOn(app.vault.adapter, 'list')
  await expect(recoverOrphanPrivateArtifacts(app as never, new IDBFactory())).rejects.toThrow(
    /symbolic link/i
  )
  expect(list.mock.calls.some(([p]) => p === root)).toBe(false)
})
