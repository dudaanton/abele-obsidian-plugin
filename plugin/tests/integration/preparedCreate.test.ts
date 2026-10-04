import { afterEach, expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { ChangeTracker, type Recording } from '@/ai/rewind/ChangeTracker'
import { useVault } from '../helpers/testEnv'

let tracker: ChangeTracker | undefined
afterEach(() => {
  tracker?.uninstall()
  vi.restoreAllMocks()
})
function setup() {
  const app = useVault([]) as unknown as App
  tracker = ChangeTracker.install(app)
  const first: Recording = { record: vi.fn() }
  const second: Recording = { record: vi.fn() }
  tracker.open(first)
  tracker.open(second)
  return { app, tracker, first, second }
}
it('records successful prepared creation once in ALL open recordings with missing before-state', async () => {
  const { app, tracker, first, second } = setup()
  const validate = vi.fn(() => {
    expect(app.vault.getAbstractFileByPath('sample.zip')).toBeNull()
  })
  const read = vi.spyOn(app.vault, 'readBinary')
  await tracker.prepareCreate(
    'sample.zip',
    'binary',
    validate
  )(() => app.vault.createBinary('sample.zip', new Uint8Array([1, 2]).buffer))
  expect(validate).toHaveBeenCalledOnce()
  expect(read).toHaveBeenCalledTimes(1) // fingerprint AFTER successful creation only
  for (const recording of [first, second]) {
    expect(recording.record).toHaveBeenCalledOnce()
    expect(vi.mocked(recording.record).mock.calls[0][1]).toMatchObject([
      { path: 'sample.zip', before: { t: 'missing' } },
    ])
  }
})
it('rejects collisions without reading unexpected destination content or recording success', async () => {
  const { app, tracker, first } = setup()
  await tracker.mute(() => app.vault.createBinary('sample.zip', new Uint8Array([9]).buffer))
  const read = vi.spyOn(app.vault, 'readBinary')
  await expect(
    tracker.prepareCreate('sample.zip', 'binary', () => {
      throw new Error('Collision')
    })(() => app.vault.createBinary('sample.zip', new ArrayBuffer(0)))
  ).rejects.toThrow('Collision')
  expect(read).not.toHaveBeenCalled()
  expect(first.record).not.toHaveBeenCalled()
})
it('validates when inactive or muted and records nothing for rejected native creation', async () => {
  const { app, tracker, first } = setup()
  const validate = vi.fn(() => {
    throw new Error('Stopped')
  })
  const native = vi.fn(async () => {})
  await expect(
    tracker.mute(() => tracker.prepareCreate('folder', 'folder', validate)(native))
  ).rejects.toThrow('Stopped')
  expect(native).not.toHaveBeenCalled()
  await expect(
    tracker.prepareCreate('sample.zip', 'binary', () => {})(async () => {
      throw new Error('Disk failure')
    })
  ).rejects.toThrow('Disk failure')
  expect(first.record).not.toHaveBeenCalled()
  tracker.uninstall()
  const inactive = ChangeTracker.install(app)
  await expect(inactive.prepareCreate('sample.zip', 'binary', validate)(native)).rejects.toThrow(
    'Stopped'
  )
  expect(validate).toHaveBeenCalledTimes(2)
})
it('settles an issued native creation before returning even if Stop arrives', async () => {
  const { app, tracker, first } = setup()
  const controller = new AbortController()
  await tracker.prepareCreate('sample.zip', 'binary', () => controller.signal.throwIfAborted())(
    async () => {
      controller.abort()
      return await app.vault.createBinary('sample.zip', new Uint8Array([1]).buffer)
    }
  )
  expect(first.record).toHaveBeenCalledOnce()
  expect(app.vault.getAbstractFileByPath('sample.zip')).not.toBeNull()
})
