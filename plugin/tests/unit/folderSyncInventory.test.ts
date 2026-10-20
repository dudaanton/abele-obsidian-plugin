import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { MemoryStateStore, scan, sha256 } from '@abele/sync-sdk/core'

it('rehashes restored bytes with unchanged metadata instead of trusting a live receipt', async () => {
  const app = buildFakeVault([])
  const fs = new ObsidianFileSystem(app as unknown as App, { fileScope: 'Shared' })
  const path = 'Shared/sample.bin'
  const bytes = new TextEncoder().encode('before')
  const sha = await sha256(bytes)
  const stage = await fs.beginAtomicWrite(path, 1000, null)
  await stage.append(0, bytes)
  await stage.seal({ size: bytes.length, sha })
  await stage.commit()
  const state = new MemoryStateStore()
  await state.put({
    path,
    wirePath: path,
    fileId: 'sample',
    versionId: 'v1',
    size: bytes.length,
    mtime: 1000,
    sha,
  })
  await app.vault.adapter.writeBinary(path, new TextEncoder().encode('after!').buffer, {
    mtime: 1000,
  })
  const result = await scan(fs, state, { excluded: () => false }, { revalidate: 'all' })
  expect(result.skipped).toEqual([])
  expect(result.ops).toEqual([
    expect.objectContaining({
      op: 'modify',
      file_id: 'sample',
      sha: await sha256(new TextEncoder().encode('after!')),
    }),
  ])
})

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
