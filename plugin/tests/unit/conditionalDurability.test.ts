import { expect, it, vi } from 'vitest'
import { ConditionalFiles, type ConditionalFileHost } from '@/sync/conditionalFiles'
import { deferred } from '../helpers/deferred'

it('flushes captured content before starting either namespace barrier', async () => {
  const content = deferred<void>()
  const flush = vi.fn(async () => {})
  const host = { flushContents: () => content.promise, flush } as unknown as ConditionalFileHost
  const files = new ConditionalFiles(host)
  const pending = Reflect.get(files, 'flushMove').call(files, 'before.md', 'private/victim')
  expect(flush).not.toHaveBeenCalled()
  content.resolve()
  await pending
  expect(flush.mock.calls).toEqual([
    ['private/victim', true],
    ['before.md', true],
  ])
})

it('waits for an issued namespace barrier even if the other call throws synchronously', async () => {
  const held = deferred<void>()
  const entered = deferred<void>()
  const failure = new Error('namespace ownership changed')
  const host = {
    flushContents: async () => {},
    flush: (path: string) => {
      if (path === 'private/victim') {
        entered.resolve()
        return held.promise
      }
      throw failure
    },
  } as unknown as ConditionalFileHost
  const files = new ConditionalFiles(host)
  let outcome: unknown
  const pending = Reflect.get(files, 'flushMove')
    .call(files, 'before.md', 'private/victim')
    .then(
      () => {
        outcome = 'acknowledged'
      },
      (error: unknown) => {
        outcome = error
      }
    )
  await entered.promise
  try {
    for (let turn = 0; turn < 8; turn++) await Promise.resolve()
    expect(outcome).toBeUndefined()
  } finally {
    held.resolve()
    await pending
  }
  expect(outcome).toBe(failure)
})
