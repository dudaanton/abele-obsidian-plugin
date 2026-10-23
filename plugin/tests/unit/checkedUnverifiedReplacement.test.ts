import { expect, it, vi } from 'vitest'
import { sha256 } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

it('retains an unreadable existing target before publishing verified incoming bytes', async () => {
  const app = buildFakeVault([])
  const old = new Uint8Array(2 * 1024 * 1024 + 17).fill(53)
  const incoming = new TextEncoder().encode('incoming sample')
  await app.vault.adapter.writeBinary('sample.bin', old.buffer, { mtime: 1000 })
  const read = app.vault.adapter.readBinary.bind(app.vault.adapter)
  const whole = vi.spyOn(app.vault.adapter, 'readBinary').mockImplementation(async (path) => {
    if ((await app.vault.adapter.stat(path))!.size > 1024 * 1024) throw new Error('unbounded read')
    return read(path)
  })
  const disk = new ObsidianFileSystem(app as never)
  expect(
    await disk.conditionalFile({
      path: 'sample.bin',
      expected: { size: old.length, mtime: 1000, sha: await sha256(old) },
      effect: { kind: 'write', bytes: incoming, mtime: 2000 },
    })
  ).toBe(true)
  expect(await sha256(new Uint8Array(await read('sample.bin')))).toBe(await sha256(incoming))
  const root = '.obsidian/plugins/abele/sync-conditional/trash'
  const folders = (await app.vault.adapter.list(root)).folders
  expect(folders).toHaveLength(1)
  const victim = folders[0] + '/victim'
  expect(await sha256(new Uint8Array(await read(victim)))).toBe(await sha256(old))
  await disk.recoverConditionalFiles()
  expect(await sha256(new Uint8Array(await read(victim)))).toBe(await sha256(old))
  expect((await app.vault.adapter.list('')).files).toEqual(['sample.bin'])
  expect(whole.mock.calls.some(([path]) => path === 'sample.bin' || path === victim)).toBe(false)
})
