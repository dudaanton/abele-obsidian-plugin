import { expect, it } from 'vitest'
import { adapterStore, rewindDir } from '@/ai/rewind/RewindStore'
import { bytesHash } from '@/ai/rewind/vaultFs'
import { buildFakeVault } from '../helpers/fakeVault'

it('writes portable blob filenames while retaining the fingerprint in the log', async () => {
  const app = buildFakeVault([])
  const store = adapterStore(app as never)
  const bytes = new Uint8Array([2, 4, 6]).buffer
  const name = bytesHash(bytes)
  await store.writeBlob('sample-chat', name, bytes)
  const { files } = await app.vault.adapter.list(rewindDir(app as never) + '/sample-chat')
  expect(files).toHaveLength(1)
  expect(files[0].split('/').pop()).not.toMatch(/[\\:*?"<>|]/)
  expect(await store.readBlob('sample-chat', name)).toEqual(bytes)
  await store.removeBlob('sample-chat', name)
  expect(await store.readBlob('sample-chat', name)).toBeNull()
})

it('reads old blob filenames without moving or rewriting history', async () => {
  const bytes = new Uint8Array([3, 5, 7]).buffer
  const name = bytesHash(bytes)
  const app = buildFakeVault([
    { path: `.obsidian/plugins/abele/rewind/sample-chat/${name}.bin`, content: '' },
  ])
  const store = adapterStore(app as never)
  const legacy = `${rewindDir(app as never)}/sample-chat/${name}.bin`
  await app.vault.adapter.writeBinary(legacy, bytes)
  expect(await store.readBlob('sample-chat', name)).toEqual(bytes)
  expect(await app.vault.adapter.exists(legacy)).toBe(true)
  const updated = new Uint8Array([8, 9, 10]).buffer
  await store.writeBlob('sample-chat', name, updated)
  expect(await store.readBlob('sample-chat', name)).toEqual(updated)
  expect(await app.vault.adapter.readBinary(legacy)).toEqual(bytes)
  await store.removeBlob('sample-chat', name)
  expect(await store.readBlob('sample-chat', name)).toBeNull()
  expect(await app.vault.adapter.exists(legacy)).toBe(false)
})
