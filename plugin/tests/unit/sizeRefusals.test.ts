import { expect, it, vi } from 'vitest'
import { MemoryFileSystem, MemoryStateStore } from '@abele/sync-sdk/core'
import { SizeRefusals } from '@/sync/sizeRefusals'

it('inventories refusal keys once without reading metadata for unrefused paths', async () => {
  const state = new MemoryStateStore(),
    fs = new MemoryFileSystem()
  const keys = vi.spyOn(state, 'metadataKeys'),
    read = vi.spyOn(state, 'getMeta')
  const refusals = new SizeRefusals(
    state,
    fs,
    () => 'sample-context',
    () => 4
  )
  for (let i = 0; i < 33000; i++)
    await refusals.assertAllowed(`sample-${i}.bin`, { sha: 'a'.repeat(64), size: 8 })
  expect(keys).toHaveBeenCalledTimes(1)
  expect(read).not.toHaveBeenCalled()
})
it('does not publish an uncommitted refusal or preserve it after rollback', async () => {
  const state = new MemoryStateStore(),
    fs = new MemoryFileSystem()
  await fs.writeAtomic('sample.bin', new Uint8Array(8), 1000)
  const refusals = new SizeRefusals(
    state,
    fs,
    () => 'sample-context',
    () => 4
  )
  await expect(
    state.transaction(async (tx) => {
      await refusals.record(
        {
          path: 'sample.bin',
          op: { op: 'create', path: 'sample.bin', sha: 'a'.repeat(64), size: 8, mtime: 1000 },
          code: 'too_large',
          message: 'sample limit',
        },
        tx
      )
      throw new Error('sample rollback')
    })
  ).rejects.toThrow('sample rollback')
  await expect(
    refusals.assertAllowed('sample.bin', { sha: 'a'.repeat(64), size: 8 })
  ).resolves.toBeUndefined()
})
it('cancellation wins over a remembered refusal and corrupted cache data cannot refuse a file', async () => {
  const state = new MemoryStateStore(),
    fs = new MemoryFileSystem()
  await state.setMeta('plugin:size-refusal:sample.bin', 'invalid sample json')
  const refusals = new SizeRefusals(
    state,
    fs,
    () => 'sample-context',
    () => 4
  )
  await expect(
    refusals.assertAllowed('sample.bin', { sha: 'a'.repeat(64), size: 8 })
  ).resolves.toBeUndefined()
  const controller = new AbortController()
  controller.abort()
  await expect(
    refusals.assertAllowed('sample.bin', { sha: 'a'.repeat(64), size: 8 }, controller.signal)
  ).rejects.toBeDefined()
})
