import { expect, it } from 'vitest'
import { constants } from 'node:fs'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'

it('keeps native object identity and timestamps across link and capture', async () => {
  const app = buildFakeVault([])
  await app.vault.adapter.writeBinary('sample.bin', new Uint8Array([1, 2]).buffer, { mtime: 1234 })
  withDesktopFs(app)
  const native = Reflect.get(app.vault.adapter, 'fsPromises')
  const before = await native.stat('/vault/sample.bin')
  await native.link('/vault/sample.bin', '/vault/alias.bin')
  await native.rename('/vault/alias.bin', '/vault/captured.bin')
  const captured = await native.stat('/vault/captured.bin')
  expect(captured.ino).toBe(before.ino)
  expect(captured.mtimeMs).toBe(1234)
  expect(captured.size).toBe(2)
})

it('rejects oversized native backing buffers at both transfer boundaries', async () => {
  const app = buildFakeVault([])
  await app.vault.adapter.writeBinary('sample.bin', new Uint8Array([1, 2]).buffer)
  withDesktopFs(app, { maxBufferBytes: 8 })
  const native = Reflect.get(app.vault.adapter, 'fsPromises')
  const handle = await native.open('/vault/sample.bin', constants.O_RDWR)
  try {
    await expect(handle.read(new Uint8Array(9), 0, 1, 0)).rejects.toThrow('fixture bound')
    await expect(handle.write(new Uint8Array(9), 0, 1, 0)).rejects.toThrow('fixture bound')
  } finally {
    await handle.close()
  }
  expect(new Uint8Array(await app.vault.adapter.readBinary('sample.bin'))).toEqual(
    new Uint8Array([1, 2])
  )
})
