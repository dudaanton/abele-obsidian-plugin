import { expect, it } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

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
