import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { MemoryStateStore } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

it('lists each absent ledger parent once per scan, not once per missing file', async () => {
  const app = buildFakeVault([]),
    state = new MemoryStateStore()
  for (let i = 0; i < 1000; i++) {
    const path = `Shared/dir-${i % 60}/note-${i}.md`
    await state.put({
      path,
      wirePath: path,
      fileId: `file-${i}`,
      versionId: `version-${i}`,
      sha: 'a'.repeat(64),
      size: 6,
      mtime: 1000,
    })
  }
  const list = vi
    .spyOn(app.vault.adapter, 'list')
    .mockRejectedValue(Object.assign(new Error('Folder is absent'), { code: 'ENOENT' }))
  const fs = new ObsidianFileSystem(app as unknown as App, {
    ledger: state,
    discovery: { roots: ['Shared'], includes: (path) => path.startsWith('Shared/') },
  })
  const started = performance.now()
  const found = []
  for await (const info of fs.list()) found.push(info)
  expect(found).toEqual([])
  expect(list.mock.calls.length).toBeLessThanOrEqual(60)
  expect(performance.now() - started).toBeLessThan(250)
})
