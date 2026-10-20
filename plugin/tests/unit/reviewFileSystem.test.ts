import { expect, it, vi } from 'vitest'
import { MemoryFileSystem } from '@abele/sync-sdk/core'
import { reviewFileSystem } from '@/sync/reviewFileSystem'
import { PLACEMENT } from '@/sync/pathCoordinator'

it.each(['mkdir', 'moveDirectory', 'removeDirectory', 'writeAtomic', 'move', 'remove'])(
  'checks approval before the %s filesystem effect',
  async (method) => {
    const effect = vi.fn(async () => {})
    const fs = Object.assign(new MemoryFileSystem(), { [method]: effect })
    let trusted = true
    const guarded = reviewFileSystem(fs, () => {
      if (!trusted) throw new Error('Trust revoked')
    })
    const mutation = Reflect.get(guarded, method) as () => Promise<void>
    trusted = false
    await expect(mutation()).rejects.toThrow('Trust revoked')
    expect(effect).not.toHaveBeenCalled()
  }
)

it.each(['beginAtomicWrite', 'reopenStage'])(
  'checks approval again when a stage from %s publishes',
  async (method) => {
    const commit = vi.fn(async () => {})
    const stage = {
      id: 'sample-stage',
      offset: 0,
      append: vi.fn(),
      seal: vi.fn(),
      commit,
      discard: vi.fn(),
    }
    const fs = Object.assign(new MemoryFileSystem(), { [method]: async () => stage })
    let trusted = true
    const guarded = reviewFileSystem(fs, () => {
      if (!trusted) throw new Error('Trust revoked')
    })
    const open = Reflect.get(guarded, method) as () => Promise<typeof stage>
    const pending = await open()
    trusted = false
    await expect(pending.commit()).rejects.toThrow('Trust revoked')
    expect(commit).not.toHaveBeenCalled()
    await pending.discard()
    expect(stage.discard).toHaveBeenCalledOnce()
  }
)

it('checks approval after waiting for placement without dropping the underlying lock', async () => {
  let trusted = true
  const placement = vi.fn(async (_paths: string[], work: () => Promise<void>) => {
    trusted = false
    return work()
  })
  const fs = Object.assign(new MemoryFileSystem(), { [PLACEMENT]: placement })
  const guarded = reviewFileSystem(fs, () => {
    if (!trusted) throw new Error('Trust revoked')
  })
  const work = vi.fn(async () => {})
  await expect(guarded[PLACEMENT](['Scripts/sample.js'], work)).rejects.toThrow('Trust revoked')
  expect(placement).toHaveBeenCalledOnce()
  expect(work).not.toHaveBeenCalled()
})
