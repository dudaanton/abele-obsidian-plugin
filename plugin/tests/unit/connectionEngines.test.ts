import { expect, it, vi } from 'vitest'
import { ConnectionEngines } from '@/sync/connectionEngines'
import { deferred } from '../helpers/deferred'

it('removes a connection before its queued startup can create effects', async () => {
  const engines = new ConnectionEngines()
  const start = vi.fn(async () => {})
  const close = vi.fn(async () => {})
  engines.start(
    ['sample'],
    () => ({ start, close, invalidate() {} }),
    () => {}
  )
  await engines.remove('sample')
  expect(start).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledOnce()
  await engines.close()
  expect(close).toHaveBeenCalledOnce()
})

it('retains a failed drain until it can be retried', async () => {
  const engines = new ConnectionEngines()
  const close = vi
    .fn()
    .mockRejectedValueOnce(new Error('drain failed'))
    .mockResolvedValue(undefined)
  engines.start(
    ['sample'],
    () => ({ start: async () => {}, close, invalidate() {} }),
    () => {}
  )
  await engines.settled()
  await expect(engines.remove('sample')).rejects.toThrow('drain failed')
  await engines.remove('sample')
  expect(close).toHaveBeenCalledTimes(2)
  await engines.close()
  expect(close).toHaveBeenCalledTimes(2)
})

it('starts independently and revokes every runtime before waiting on shutdown', async () => {
  const engines = new ConnectionEngines()
  const slow = deferred<void>()
  const events: string[] = []
  engines.start(
    ['offline', 'ready'],
    (id) => ({
      start: async () => {
        events.push('start:' + id)
        if (id === 'offline') await slow.promise
      },
      invalidate: () => {
        events.push('invalidate:' + id)
      },
      close: async () => {
        events.push('close:' + id)
      },
    }),
    () => {}
  )
  await Promise.resolve()
  expect(events).toContain('start:ready')
  const closing = engines.close()
  expect(events.slice(2, 4)).toEqual(['invalidate:offline', 'invalidate:ready'])
  slow.resolve()
  await closing
  expect(events).toContain('close:ready')
})

it('does not start queued engines after shutdown and isolates factory failures', async () => {
  const engines = new ConnectionEngines()
  const events: string[] = []
  engines.start(
    ['broken', 'ready'],
    (id) => {
      if (id === 'broken') throw new Error('cannot open')
      return {
        start: async () => {
          events.push('started')
        },
        invalidate: () => {},
        close: async () => {},
      }
    },
    (id) => {
      events.push('failed:' + id)
    }
  )
  await engines.close()
  expect(events).toEqual(['failed:broken'])
})
