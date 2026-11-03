import { expect, it } from 'vitest'
import { MemoryFileSystem, MemoryStateStore, scan } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { buildFakeVault } from '../helpers/fakeVault'

const pass = Symbol.for('abele.sync.inventory-pass-v1')
const children = Symbol.for('abele.sync.inventory-children-v1')
const directories = Symbol.for('abele.sync.inventory-directories-v1')

it('lists group file ancestors without claiming a physical directory identity', async () => {
  const path = 'Shared/Field notes/sample.md'
  const app = buildFakeVault([{ path, content: 'sample group note' }])
  const host = new ObsidianFileSystem(app as never, {
    discovery: { roots: [], includes: (candidate) => candidate === path },
  })
  await Reflect.get(host, pass).call(host, async () => {
    await expect(host.listChildren('Shared')).resolves.toEqual([
      { path: 'Shared/Field notes', kind: 'directory' },
    ])
    expect(await Array.fromAsync(host.listDirectories())).toEqual([])
    await expect(host.mkdir('Shared/Field notes')).rejects.toThrow('outside this connection')
    expect(app.loadLocalStorage('abele-sync-local-directories-v1') ?? []).toEqual([])
  })
})

it.each([
  [' bad.md', 'leading space'],
  ['bad\\name.md', 'forbidden character'],
  ['bad\nname.md', 'forbidden character'],
])('reports unrepresentable local name %s without stopping sync', async (name, reason) => {
  const disk = new MemoryFileSystem()
  await disk.writeAtomic(`Shared/${name}`, new TextEncoder().encode('sample'), 1)
  const fs = new LocalFolderPlacement('Remote', 'Shared').fileSystem(disk)
  const result = await scan(fs, new MemoryStateStore(), { excluded: () => false })
  expect(result.ops).toEqual([])
  expect(result.skipped).toEqual([
    expect.objectContaining({ path: `Remote/${name}`, reason: expect.stringContaining(reason) }),
  ])
})

it.each([false, true])('uses scan visibility in all inventories (cached=%s)', async (cached) => {
  const app = buildFakeVault([
    { path: 'Shared/Notes/sample.md', content: 'sample' },
    ...['.obsidian', '.trash', '.git', '.hidden'].flatMap((name) => [
      { path: `Shared/${name}/file.md`, content: 'private' },
      { path: `Shared/Notes/${name}/file.md`, content: 'private' },
    ]),
    { path: 'Shared/.hidden-file.md', content: 'private' },
    { path: 'Shared/Notes/.hidden-file.md', content: 'private' },
  ])
  const host = new ObsidianFileSystem(app as never, { fileScope: 'Shared' })
  // A previous inventory may have retained this physical identity (D-229).
  await Reflect.get(host, Symbol.for('abele.sync.directory-identity-v1')).call(
    host,
    'Shared/.obsidian'
  )
  const fs = new LocalFolderPlacement('Remote', 'Shared').fileSystem(host)
  const check = async () => {
    for (const parent of ['Remote', 'Remote/Notes']) {
      const expected = parent === 'Remote' ? ['Remote/Notes'] : ['Remote/Notes/sample.md']
      expect((await fs.listChildren!(parent)).map((one) => one.path)).toEqual(expected)
      expect(
        (await Reflect.get(fs, children)(parent, `${parent}/sample.md`)).map(
          (one: { path: string }) => one.path
        )
      ).toEqual(expected)
      for (const one of await Reflect.get(fs, children)(parent, `${parent}/sample.md`, true))
        expect(one.path).not.toMatch(/\/\./)
    }
    const listed = await Array.fromAsync(fs.list())
    expect(listed.map((one) => one.path)).toEqual(['Remote/Notes/sample.md'])
    for (const one of await Array.fromAsync(fs.listDirectories!()))
      expect(one.path).not.toMatch(/\/\./)
    for (const one of await Reflect.get(fs, directories)()) expect(one.path).not.toMatch(/\/\./)
  }
  if (cached) await Reflect.get(host, pass).call(host, check)
  else await check()
  expect(await app.vault.adapter.read('Shared/.obsidian/file.md')).toBe('private')
  expect(await app.vault.adapter.read('Shared/Notes/.hidden-file.md')).toBe('private')
})

it('retains root configuration files and directories in public inventory', async () => {
  const app = buildFakeVault([{ path: '.obsidian/plugins/sample-tool/data.json', content: '{}' }])
  const fs = new ObsidianFileSystem(app as never)
  expect((await fs.listChildren('')).map((one) => one.path)).toContain('.obsidian')
  expect((await fs.listChildren('.obsidian/plugins')).map((one) => one.path)).toContain(
    '.obsidian/plugins/sample-tool'
  )
})

it('distinguishes invalid local names from unrelated roots', () => {
  const placement = new LocalFolderPlacement('Remote', 'Shared')
  try {
    placement.toServer('Shared/.hidden/file.md')
    expect.fail('invalid name must be rejected')
  } catch (error) {
    expect(error).toMatchObject({ code: 'invalid_path' })
    expect(String(error)).not.toContain('outside this connection')
    expect(String(error)).toContain('leading dot')
  }
  expect(() => placement.toServer('Other/sample.md')).toThrow('outside this connection')
})
