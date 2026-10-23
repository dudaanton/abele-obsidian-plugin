import { expect, it } from 'vitest'
import { nativeOf } from '@/sync/nativeVaultFs'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'

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
