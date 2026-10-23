import { expect, it, vi } from 'vitest'
import {
  mutationCheckedAdapter,
  guardedVaultAdapter,
  connectionAdapter,
} from '@/sync/vaultPathLinks'
import { buildFakeVault } from '../helpers/fakeVault'
import { virtualNativeVault } from '../helpers/virtualNativeVault'
import { desktopFsPort } from '../helpers/desktopRequire'

it.each([
  'write',
  'writeBinary',
  'append',
  'appendBinary',
  'process',
  'copy',
  'remove',
  'rmdir',
  'trashLocal',
  'trashSystem',
  'rename',
])('denies public %s through a rebuilt scoped lease port', async (method) => {
  const app = buildFakeVault([])
  const leaf = vi.fn(async () => {})
  Reflect.set(app.vault.adapter, method, leaf)
  const scoped = connectionAdapter(
    guardedVaultAdapter(app.vault.adapter as never),
    'scope',
    '.abele-sync'
  )
  const disk = mutationCheckedAdapter(scoped, () => {}, ['.abele-sync/private'])
  await expect(
    Promise.resolve().then(() => Reflect.get(disk, method)('scope/public.bin', 'scope/other.bin'))
  ).rejects.toThrow()
  expect(leaf).not.toHaveBeenCalled()
})

it.each([
  '.obsidian/workspace.json',
  '.obsidian/plugins/other/data.json',
  'sample.bin',
  '.abele-sync/other/file',
])('does not classify config or unrelated private-looking paths as owned: %s', async (path) => {
  const app = buildFakeVault([])
  const write = vi.spyOn(app.vault.adapter, 'writeBinary')
  const disk = mutationCheckedAdapter(app.vault.adapter as never, () => {}, ['.abele-sync/owned'])
  await expect(
    Promise.resolve().then(() => disk.writeBinary(path, new ArrayBuffer(0)))
  ).rejects.toMatchObject({ rawPublicMutation: true })
  expect(write).not.toHaveBeenCalled()
})

it.each(['write', 'truncate', 'utimes', 'chmod'])(
  'denies public native handle %s even after a read-only open',
  async (method) => {
    const fixture = virtualNativeVault()
    desktopFsPort(fixture.native)
    const bytes = new Uint8Array([0, 128, 255])
    await fixture.app.vault.adapter.writeBinary('sample.bin', bytes.buffer)
    const open = fixture.native.open
    const effect = vi.fn(async () => {})
    fixture.native.open = async (...args) => {
      const handle = await open(...args)
      Reflect.set(handle, method, effect)
      return handle
    }
    const disk = mutationCheckedAdapter(fixture.app.vault.adapter as never, () => {})
    const handle = await Reflect.get(disk, 'fsPromises').open('sample-vault/sample.bin', 'r')
    try {
      await expect(
        Promise.resolve().then(() => handle[method](bytes, 0, bytes.length, 0))
      ).rejects.toMatchObject({ rawPublicMutation: true })
      expect(effect).not.toHaveBeenCalled()
      expect([...new Uint8Array(await fixture.app.vault.adapter.readBinary('sample.bin'))]).toEqual(
        [...bytes]
      )
    } finally {
      await handle.close()
    }
  }
)
