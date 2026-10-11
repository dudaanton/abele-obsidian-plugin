import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { WriteJournal } from '@/sync/writeJournal'
import { EditCopies } from '@/sync/editCopies'
import { MemoryStateStore } from '@abele/sync-core'

const bytes = new TextEncoder().encode('sample streamed replacement')
const setup = () => {
  const app = buildFakeVault([{ path: 'sample.bin', content: 'original' }])
  const data = new Map<string, unknown>()
  const storage = {
    loadLocalStorage: (key: string) => data.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => {
      data.set(key, structuredClone(value))
    },
  }
  const fs = () => new ObsidianFileSystem(app as unknown as App, { storage })
  return { app, fs, storage }
}
it('retains local edits as sealed source locators and verifies retained bytes on every read', async () => {
  const { app, fs } = setup()
  const writer = fs(),
    copies = new EditCopies(),
    store = new MemoryStateStore()
  copies.expect(['destination'])
  copies.register('destination', store, () => true)
  const read = vi.spyOn(writer, 'read').mockRejectedValue(new Error('whole file read'))
  await copies.capture(writer, ['sample.bin'])
  const [copy] = await copies.list(store)
  expect(copy.bytes).toEqual([])
  expect(copy.source?.size).toBe(8)
  expect(read).not.toHaveBeenCalled()
  await app.vault.adapter.writeBinary(copy.source!.id, new Uint8Array([1]).buffer)
  await expect(copies.list(store)).rejects.toThrow('integrity')
})
it('reopens a partial stage after restart, verifies it, and publishes through the journal', async () => {
  const { app, fs, storage } = setup()
  const first = fs()
  const base = await first.fingerprint('sample.bin')
  const stage = await first.beginAtomicWrite('sample.bin', 123, base)
  await stage.append(0, bytes.slice(0, 6))
  const restarted = fs()
  await restarted.recover()
  const resumed = await restarted.reopenStage(stage.id)
  expect(resumed.offset).toBe(6)
  await resumed.append(6, bytes.slice(6))
  await resumed.seal({ size: bytes.length, sha: await sha256(bytes) })
  await resumed.commit()
  expect(new Uint8Array(await app.vault.adapter.readBinary('sample.bin'))).toEqual(bytes)
  expect(new WriteJournal(storage).entries()).toEqual([])
})
it('retains the stage on cancellation and does not publish corrupt or stale bytes', async () => {
  const { app, fs } = setup()
  const writer = fs()
  const base = await writer.fingerprint('sample.bin')
  const stage = await writer.beginAtomicWrite('sample.bin', 123, base)
  const abort = new AbortController()
  abort.abort(new Error('cancelled'))
  await expect(stage.append(0, bytes, abort.signal)).rejects.toThrow('cancelled')
  expect(stage.offset).toBe(0)
  await stage.append(0, bytes)
  await expect(stage.seal({ size: bytes.length, sha: '0'.repeat(64) })).rejects.toThrow('integrity')
  await stage.seal({ size: bytes.length, sha: await sha256(bytes) })
  await app.vault.adapter.writeBinary(
    'sample.bin',
    new TextEncoder().encode('independent edit').buffer
  )
  await expect(stage.commit()).rejects.toThrow('changed')
  expect(await app.vault.adapter.read('sample.bin')).toBe('independent edit')
  await stage.discard()
  expect(await app.vault.adapter.exists(stage.id)).toBe(false)
})
it('resumes from the actual appended length when cancellation arrives with the disk acknowledgement', async () => {
  const { app, fs } = setup()
  const writer = fs(),
    abort = new AbortController()
  const stage = await writer.beginAtomicWrite('incoming.bin', 1000, null)
  const write = app.vault.adapter.writeBinary.bind(app.vault.adapter)
  app.vault.adapter.writeBinary = async (...args) => {
    await write(...args)
    abort.abort(new Error('cancelled'))
  }
  await expect(stage.append(0, bytes.slice(0, 5), abort.signal)).rejects.toThrow('cancelled')
  expect(stage.offset).toBe(5)
  app.vault.adapter.writeBinary = write
  const resumed = await writer.reopenStage(stage.id)
  await resumed.append(resumed.offset, bytes.slice(5))
  await resumed.seal({ size: bytes.length, sha: await sha256(bytes) })
  await resumed.commit()
  await resumed.discard()
  expect(new Uint8Array(await app.vault.adapter.readBinary('incoming.bin'))).toEqual(bytes)
})
it('rechecks ownership after awaited provenance, before stage publication', async () => {
  const { app, storage } = setup()
  let held = true
  const fence = {
    assertReady: () => {
      if (!held) throw new Error('closed')
    },
    assertOwned: () => {
      if (!held) throw new Error('closed')
    },
    effect: <T>(work: () => T): T => work(),
  }
  const fs = new ObsidianFileSystem(app as unknown as App, {
    storage,
    runtimeFence: fence as never,
    beforeEngineMutation: async () => {
      held = false
    },
  })
  const stage = await fs.beginAtomicWrite('incoming.bin', 100, null)
  await stage.append(0, bytes)
  await stage.seal({ size: bytes.length, sha: await sha256(bytes) })
  const rename = vi.spyOn(app.vault.adapter, 'rename')
  await expect(stage.commit()).rejects.toThrow('closed')
  expect(rename).not.toHaveBeenCalled()
})
