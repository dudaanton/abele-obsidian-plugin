import { expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { scopedFileSystem } from '@/sync/scopedFileSystem'

const inventory = Symbol.for('abele.sync.inventory-children-v1')
const pass = Symbol.for('abele.sync.inventory-pass-v1')

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
