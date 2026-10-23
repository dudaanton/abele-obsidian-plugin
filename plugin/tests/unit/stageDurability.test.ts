import { expect, it } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'

it('flushes the stage parent before acknowledging allocation and discard', async () => {
  const app = buildFakeVault([])
  withDesktopFs(app)
  const native = Reflect.get(app.vault.adapter, 'fsPromises')
  const open = native.open.bind(native)
  const events: string[] = []
  native.open = async (path: string, flags: string) => {
    const handle = await open(path, flags)
    const sync = handle.sync.bind(handle)
    handle.sync = async () => {
      events.push(path)
      await sync()
    }
    return handle
  }
  const fs = new ObsidianFileSystem(app as never)
  const stage = await fs.beginAtomicWrite('sample.bin', 1000, null)
  const parent = '/vault/' + stage.id.slice(0, stage.id.lastIndexOf('/'))
  expect(events).toContain(parent)
  events.length = 0
  await stage.discard!()
  expect(events).toContain(parent)
  expect(await app.vault.adapter.exists(stage.id)).toBe(false)
})

it('sets the acknowledged stage timestamp before its final file barrier', async () => {
  const app = buildFakeVault([])
  withDesktopFs(app)
  const native = Reflect.get(app.vault.adapter, 'fsPromises')
  const open = native.open.bind(native),
    date = native.utimes.bind(native)
  const events: string[] = []
  native.utimes = async (...args: unknown[]) => {
    events.push('date')
    return date(...args)
  }
  native.open = async (path: string, flags: string) => {
    const handle = await open(path, flags)
    const sync = handle.sync.bind(handle)
    handle.sync = async () => {
      events.push('sync')
      await sync()
    }
    return handle
  }
  const fs = new ObsidianFileSystem(app as never)
  const stage = await fs.beginAtomicWrite('sample.bin', 1000, null)
  events.length = 0
  await stage.append(0, new Uint8Array([1, 2, 3]))
  expect(events).toEqual(['date', 'sync'])
})
