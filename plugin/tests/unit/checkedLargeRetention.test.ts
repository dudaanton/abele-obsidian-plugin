import { expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

it('captures an unverified large occupant without reading it or duplicating its bytes', async () => {
  const app = buildFakeVault([])
  const bytes = new Uint8Array(1024 + 17).fill(53)
  await app.vault.adapter.writeBinary('sample.bin', bytes.buffer)
  const disk = new ObsidianFileSystem(app as never)
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  const conditional = Reflect.get(disk, 'conditional')
  Reflect.get(conditional, 'host').checked.maxBytes = 1024
  expect(await conditional.retainUncertain('sample.bin', 'retained.bin')).toBe(true)
  expect(read.mock.calls.some(([path]) => path === 'sample.bin' || path === 'retained.bin')).toBe(
    false
  )
  expect(await app.vault.adapter.stat('sample.bin')).toBeNull()
  expect(new Uint8Array(await app.vault.adapter.readBinary('retained.bin'))).toEqual(bytes)
  expect((await app.vault.adapter.list('')).files).toEqual(['retained.bin'])
})
