import { expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { scopedFileSystem } from '@/sync/scopedFileSystem'

const inventory = Symbol.for('abele.sync.inventory-children-v1')
const pass = Symbol.for('abele.sync.inventory-pass-v1')

it('keeps the root out of cached published directory membership', async () => {
  const app = buildFakeVault([])
  const fs = new ObsidianFileSystem(app as never)
  await Reflect.get(fs, pass).call(fs, async () => {
    await Reflect.get(fs, Symbol.for('abele.sync.inventory-directories-v1')).call(fs)
    await fs.writeAtomic('sample.md', new TextEncoder().encode('sample'), 1000)
    expect(await fs.listChildren('')).not.toContainEqual(expect.objectContaining({ path: '' }))
  })
})

it('reloads only changed config directory snapshots and removes adapter observers', async () => {
  const app = buildFakeVault([
    { path: '.obsidian/a.json', content: '{}' },
    { path: 'shared/sample.md', content: 'sample' },
  ])
  const fs = new ObsidianFileSystem(app as never)
  const list = vi.spyOn(app.vault.adapter, 'list')
  const observers = Symbol.for('abele.sync.adapter-config-observers-v1')
  await Reflect.get(fs, pass).call(fs, async () => {
    await fs.listChildren('shared')
    await fs.listChildren('.obsidian')
    list.mockClear()
    await app.vault.adapter.write('.obsidian/b.json', '{}')
    expect(await fs.listChildren('.obsidian')).toContainEqual({
      path: '.obsidian/b.json',
      kind: 'file',
    })
    expect(list.mock.calls.filter(([path]) => path === '.obsidian')).toHaveLength(1)
    await fs.listChildren('shared')
    expect(list.mock.calls.filter(([path]) => path === 'shared')).toHaveLength(0)
    await app.vault.adapter.remove('.obsidian/a.json')
    expect(await fs.listChildren('.obsidian')).not.toContainEqual({
      path: '.obsidian/a.json',
      kind: 'file',
    })
    expect(Reflect.get(app.vault.adapter, observers).size).toBeGreaterThan(0)
  })
  expect(Reflect.get(app.vault.adapter, observers).size).toBe(0)
})

it('does not promote a listing changed while its read was awaiting', async () => {
  const app = buildFakeVault([{ path: '.obsidian/a.json', content: '{}' }])
  const fs = new ObsidianFileSystem(app as never)
  const list = app.vault.adapter.list.bind(app.vault.adapter)
  let injected = false
  const reads = vi.spyOn(app.vault.adapter, 'list').mockImplementation(async (path) => {
    const result = await list(path)
    if (path === '.obsidian' && !injected) {
      injected = true
      await app.vault.adapter.write('.obsidian/b.json', '{}')
    }
    return result
  })
  await Reflect.get(fs, pass).call(fs, async () => {
    expect(await fs.listChildren('.obsidian')).toContainEqual({
      path: '.obsidian/b.json',
      kind: 'file',
    })
    expect(reads.mock.calls.filter(([path]) => path === '.obsidian')).toHaveLength(2)
  })
})

it('reports local event revisions without filesystem operations and retires them after a pass', async () => {
  const app = buildFakeVault([])
  const fs = new ObsidianFileSystem(app as never)
  const mapped = scopedFileSystem(
    new LocalFolderPlacement('remote', 'local').fileSystem(fs),
    (path) => {
      if (!path.startsWith('remote/')) throw new Error('outside scope')
    },
    (path) => path.startsWith('remote/')
  )
  const mappedRevision = (path: string) =>
    Reflect.get(mapped, Symbol.for('abele.sync.local-change-revision-v1')).call(mapped, path)
  const revision = (path: string) =>
    Reflect.get(fs, Symbol.for('abele.sync.local-change-revision-v1')).call(fs, path)
  await Reflect.get(fs, pass).call(fs, async () => {
    const before = revision('sample.md')
    app.emit('vault', 'create', { path: 'sample.md' })
    expect(revision('sample.md')).toBeGreaterThan(before)
    const created = revision('sample.md')
    app.emit('vault', 'modify', { path: 'sample.md' })
    expect(revision('sample.md')).toBeGreaterThan(created)
    expect(revision('untouched.md')).toBe(0)
    app.emit('vault', 'rename', { path: 'local/nested', children: [] }, 'local/previous')
    expect(mappedRevision('remote/nested/sample.md')).toBeGreaterThan(0)
    expect(mappedRevision('remote/previous/sample.md')).toBeGreaterThan(0)
    expect(() => mappedRevision('outside/sample.md')).toThrow('outside scope')
  })
  expect(revision('sample.md')).toBeUndefined()
})

it('keeps file-only preflight separate from the full directory inventory', async () => {
  const app = buildFakeVault([
    { path: 'Shared/existing.md', content: 'sample note' },
    { path: 'Shared/nested/another.md', content: 'another note' },
  ])
  const fs = new ObsidianFileSystem(app as never)
  const directories = vi.spyOn(fs, 'listDirectories')
  await Reflect.get(fs, pass).call(fs, async () => {
    const files = await Reflect.get(fs, inventory).call(fs, 'Shared', 'Shared/target.md', true)
    expect(files).toContainEqual({ path: 'Shared/existing.md', kind: 'file' })
    expect(directories).not.toHaveBeenCalled()
    const full = await Reflect.get(fs, inventory).call(fs, 'Shared', 'Shared/target.md')
    expect(full).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'Shared/nested', kind: 'directory' }),
      ])
    )
    expect(directories).toHaveBeenCalledOnce()
  })
})

it('retains hidden-file coverage when preflight requests only files', async () => {
  const app = buildFakeVault([{ path: '.obsidian/sample.json', content: '{}' }])
  const fs = new ObsidianFileSystem(app as never)
  await Reflect.get(fs, pass).call(fs, async () => {
    const files = await Reflect.get(fs, inventory).call(
      fs,
      '.obsidian',
      '.obsidian/sample.json',
      true
    )
    expect(files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '.obsidian/sample.json', kind: 'file' }),
      ])
    )
  })
})
