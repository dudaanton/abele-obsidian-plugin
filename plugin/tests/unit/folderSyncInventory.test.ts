import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

it('keeps physical Unicode spelling inside the exact root without discovering a Unicode root sibling', async () => {
  const physical = 'Café/Cafe\u0301.md'
  const app = buildFakeVault([
    { path: physical, content: 'included' },
    { path: 'Cafe\u0301/private.md', content: 'private sibling' },
  ])
  const fs = new ObsidianFileSystem(app as unknown as App, { fileScope: 'Café' })
  const paths = []
  for await (const file of fs.list()) paths.push(file.path)
  expect(paths).toEqual([physical])
})

it('enumerates the selected indexed subtree without visiting unrelated notes or configuration', async () => {
  const app = buildFakeVault([
    { path: 'Shared/sample.md', content: 'included' },
    ...Array.from({ length: 4096 }, (_, i) => ({
      path: `Other/bucket-${i}/sample.md`,
      content: 'unrelated',
    })),
    { path: '.obsidian/plugins/sample/main.js', content: 'unrelated configuration' },
  ])
  const global = vi.spyOn(app.vault, 'getFiles')
  const list = vi.spyOn(app.vault.adapter, 'list')
  const fs = new ObsidianFileSystem(app as unknown as App, { fileScope: 'Shared' })
  const paths = []
  for await (const file of fs.list()) paths.push(file.path)
  expect(paths).toEqual(['Shared/sample.md'])
  expect(global).not.toHaveBeenCalled()
  expect(list).not.toHaveBeenCalled()
})

it('uses the current scope after a server folder rename and handles a missing indexed root', async () => {
  const app = buildFakeVault([
    { path: 'Old/sample.md', content: 'old' },
    { path: 'New/sample.md', content: 'new' },
  ])
  let scope = 'Old'
  const fs = new ObsidianFileSystem(app as unknown as App, { fileScope: () => scope })
  const collect = async () => {
    const paths = []
    for await (const file of fs.list()) paths.push(file.path)
    return paths
  }
  expect(await collect()).toEqual(['Old/sample.md'])
  scope = 'New'
  expect(await collect()).toEqual(['New/sample.md'])
  scope = 'Missing'
  expect(await collect()).toEqual([])
})
