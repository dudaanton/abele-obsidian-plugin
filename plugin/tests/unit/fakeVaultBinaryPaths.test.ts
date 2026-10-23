import { expect, it, vi } from 'vitest'
import { buildFakeVault } from '../helpers/fakeVault'

it('keeps binary bytes coherent between vault and adapter writes', async () => {
  const app = buildFakeVault([])
  const file = await app.vault.createBinary('sample.bin', new Uint8Array([255, 0, 254]).buffer)
  expect(new Uint8Array(await app.vault.adapter.readBinary(file.path))).toEqual(
    new Uint8Array([255, 0, 254])
  )
  await app.vault.adapter.writeBinary(file.path, new Uint8Array([128, 3]).buffer)
  expect(new Uint8Array(await app.vault.readBinary(file))).toEqual(new Uint8Array([128, 3]))
})

it('supplies high-level create parents while preserving adapter mutation hooks', async () => {
  const app = buildFakeVault([])
  const write = vi.spyOn(app.vault.adapter, 'writeBinary')
  const file = await app.vault.createBinary('Attachments/sample.bin', new Uint8Array([9]).buffer)
  expect(write).toHaveBeenCalledOnce()
  expect(new Uint8Array(await app.vault.readBinary(file))).toEqual(new Uint8Array([9]))
  await expect(
    app.vault.adapter.writeBinary('Missing/sample.bin', new ArrayBuffer(0))
  ).rejects.toThrow('ENOENT')
})
