import { expect, it } from 'vitest'
import { nativeOf } from '@/sync/nativeVaultFs'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'

it('publishes exclusively before a local save queued at the publication syscall', async () => {
  const app = buildFakeVault([{ path: 'incoming.bin', content: 'remote bytes' }])
  withDesktopFs(app)
  const adapter = app.vault.adapter
  const raw = adapter as unknown as {
    fsPromises: { link(from: string, to: string): Promise<void> }
  }
  const link = raw.fsPromises.link.bind(raw.fsPromises)
  let save: Promise<void> | undefined
  raw.fsPromises.link = async (from, to) => {
    if (to.endsWith('/sample.md'))
      save = adapter.writeBinary('sample.md', new TextEncoder().encode('local bytes').buffer)
    await link(from, to)
  }
  try {
    await nativeOf(adapter)!.installExclusive!('incoming.bin', 'sample.md')
  } finally {
    await save
  }
  expect(await adapter.read('sample.md')).toBe('local bytes')
})

it('captures a native victim in the save queue without reentering adapter writes', async () => {
  const app = buildFakeVault([{ path: 'sample.md', content: 'local bytes' }])
  withDesktopFs(app)
  const adapter = app.vault.adapter
  const raw = adapter as unknown as {
    queue<T>(work: () => Promise<T>): Promise<T>
    fsPromises: { rename(from: string, to: string): Promise<void> }
  }
  const rename = raw.fsPromises.rename.bind(raw.fsPromises)
  const queue = raw.queue.bind(adapter)
  let queued = false
  raw.queue = (work) =>
    queue(async () => {
      expect(queued).toBe(false)
      queued = true
      try {
        return await work()
      } finally {
        queued = false
      }
    })
  raw.fsPromises.rename = async (from, to) => {
    expect(queued).toBe(true)
    await rename(from, to)
  }
  await nativeOf(adapter)!.rename('sample.md', 'retained.md')
  expect(queued).toBe(false)
  expect(await adapter.read('retained.md')).toBe('local bytes')
  expect(await adapter.exists('sample.md')).toBe(false)
})
