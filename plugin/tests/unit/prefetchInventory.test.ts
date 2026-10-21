import { expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

const inventory = Symbol.for('abele.sync.inventory-children-v1')
const pass = Symbol.for('abele.sync.inventory-pass-v1')

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
