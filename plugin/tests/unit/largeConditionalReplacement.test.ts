import { expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { sha256 } from '@abele/sync-sdk/core'

it('quarantines an unreadable large target before exclusive publication without claiming equality', async () => {
  const app = buildFakeVault([])
  const old = new Uint8Array(2 * 1024 * 1024).fill(23)
  await app.vault.adapter.writeBinary('sample.bin', old.buffer, { mtime: 1000 })
  const rawRead = app.vault.adapter.readBinary.bind(app.vault.adapter)
  const reads = vi.spyOn(app.vault.adapter, 'readBinary').mockImplementation(async (path) => {
    if ((await app.vault.adapter.stat(path))!.size > 1024 * 1024)
      throw new Error('whole large read forbidden')
    return rawRead(path)
  })
  const fs = new ObsidianFileSystem(app as never)
  // Model a low-memory checked host without allocating a huge test payload.
  Reflect.get(Reflect.get(fs, 'conditional'), 'host').checked.maxBytes = 1024
  const receipt = 'sample-large-replacement'
  expect(
    await fs.conditionalFile({
      path: 'sample.bin',
      // Deliberately unrelated: unreadable old bytes must be retained, never authenticated by stat.
      expected: { size: old.length, mtime: 1000, sha: '0'.repeat(64) },
      effect: { kind: 'write', bytes: new Uint8Array([1, 2, 3]), mtime: 2000, receipt },
    })
  ).toBe(true)
  const retained = `.obsidian/plugins/abele/sync-conditional/trash/${receipt}/victim`
  expect(await sha256(new Uint8Array(await rawRead(retained)))).toBe(await sha256(old))
  expect(new Uint8Array(await rawRead('sample.bin'))).toEqual(new Uint8Array([1, 2, 3]))
  expect(reads.mock.calls.some(([path]) => path === 'sample.bin')).toBe(false)
  await fs.discardInstallation(receipt)
  await fs.discardInstallation(receipt)
  expect(await sha256(new Uint8Array(await rawRead(retained)))).toBe(await sha256(old))
})
