import { expect, it, vi } from 'vitest'
import { DirectEntryDurability } from '@/sync/directEntryDurability'

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('shares one directory barrier for 32 changes submitted before it starts', async () => {
  const state = new DirectEntryDurability()
  const flush = vi.fn(async () => {})
  await Promise.all(
    Array.from({ length: 32 }, (_, i) => {
      const path = `Shared/sample-${i}.bin`
      state.changed(path)
      return state.flushAncestors(path, flush)
    })
  )
  expect(flush.mock.calls).toEqual([['Shared']])
})

it('requires the next barrier for changes made during an outstanding barrier', async () => {
  const state = new DirectEntryDurability()
  const started = gate(),
    release = gate(),
    next = gate()
  const flush = vi.fn(async () => {
    if (flush.mock.calls.length === 1) {
      started.resolve()
      await release.promise
    } else await next.promise
  })
  state.changed('Shared/first.bin')
  const first = state.flushAncestors('Shared/first.bin', flush)
  await started.promise
  let acknowledged = false
  const later = Array.from({ length: 31 }, (_, i) => {
    const path = `Shared/later-${i}.bin`
    state.changed(path)
    return state.flushAncestors(path, flush)
  })
  const done = Promise.all(later).then(() => {
    acknowledged = true
  })
  release.resolve()
  await first
  expect(acknowledged).toBe(false)
  next.resolve()
  await done
  expect(flush).toHaveBeenCalledTimes(2)
})

it('rejects a failed cohort without stranding later participants or forgetting dirtiness', async () => {
  const state = new DirectEntryDurability()
  const started = gate(),
    release = gate()
  const flush = vi.fn(async () => {
    if (flush.mock.calls.length === 1) {
      started.resolve()
      await release.promise
      throw new Error('sample fsync failure')
    }
  })
  state.changed('Shared/first.bin')
  const first = expect(state.flushAncestors('Shared/first.bin', flush)).rejects.toThrow(
    'fsync failure'
  )
  await started.promise
  state.changed('Shared/second.bin')
  const second = state.flushAncestors('Shared/second.bin', flush)
  release.resolve()
  await Promise.all([first, second])
  expect(flush).toHaveBeenCalledTimes(2)
  await state.flushAncestors('Shared/first.bin', flush)
  expect(flush).toHaveBeenCalledTimes(2)
})

it('keeps a cancelled barrier dirty and allows independent directories and retries to finish', async () => {
  const state = new DirectEntryDurability()
  const started = gate(),
    release = gate()
  const controller = new AbortController()
  const cancelled = vi.fn(async () => {
    started.resolve()
    await release.promise
    controller.signal.throwIfAborted()
  })
  state.changed('Shared/cancelled.bin', 'Other/sample.bin')
  let acknowledged = false
  const pending = expect(
    state.flushAncestors('Shared/cancelled.bin', cancelled).then(() => {
      acknowledged = true
    })
  ).rejects.toThrow('sample cancellation')
  await started.promise
  const other = vi.fn(async () => {})
  await state.flushAncestors('Other/sample.bin', other)
  expect(other).toHaveBeenCalledExactlyOnceWith('Other')
  controller.abort(new Error('sample cancellation'))
  release.resolve()
  await pending
  expect(acknowledged).toBe(false)
  const retry = vi.fn(async () => {})
  await state.flushAncestors('Shared/cancelled.bin', retry)
  expect(retry).toHaveBeenCalledExactlyOnceWith('Shared')
})
