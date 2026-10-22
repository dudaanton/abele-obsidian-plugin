import { expect, it, vi } from 'vitest'
import { ConnectionEngines } from '@/sync/connectionEngines'
import { deferred } from '../helpers/deferred'

it('revokes every connection synchronously even when an invalidation hook throws at quit', async () => {
  const engines = new ConnectionEngines()
  const events: string[] = []
  engines.start(
    ['first', 'second'],
    (id) => ({
      start: async () => {},
      invalidate: () => {
        events.push('invalidate:' + id)
        if (id === 'first') throw new Error('unsubscribe failed')
      },
      close: async () => {
        events.push('close:' + id)
      },
    }),
    () => {}
  )
  await engines.settled()
  const closing = engines.close()
  const rejected = expect(closing).rejects.toThrow('unsubscribe failed')
  expect(events).toContain('invalidate:second')
  await rejected
  expect(events).toContain('close:first')
  expect(events).toContain('close:second')
})

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

it('does not revive a queued startup when its connection is removed', async () => {
  const engines = new ConnectionEngines(),
    events: string[] = []
  engines.start(
    ['retired'],
    () => ({
      start: async () => {
        events.push('start')
      },
      invalidate: () => {
        events.push('invalidate')
      },
      close: async () => {
        events.push('close')
      },
    }),
    () => {}
  )
  await engines.remove('retired')
  expect(events).toEqual(['invalidate', 'close'])
  await engines.close()
})

it('drains and removes one disconnected session without closing another connection', async () => {
  const engines = new ConnectionEngines(),
    events: string[] = []
  const factory = (id: string) => ({
    start: async () => {
      events.push('start:' + id)
    },
    invalidate: () => {
      events.push('invalidate:' + id)
    },
    close: async () => {
      events.push('close:' + id)
    },
  })
  engines.start(['placed', 'other'], factory, () => {})
  await engines.settled()
  await engines.remove('placed')
  expect(events).toEqual(['start:placed', 'start:other', 'invalidate:placed', 'close:placed'])
  engines.start(['placed', 'other'], factory, () => {})
  await engines.settled()
  expect(events.filter((one) => one === 'start:placed')).toHaveLength(2)
  expect(events.filter((one) => one === 'start:other')).toHaveLength(1)
  await engines.close()
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

it('forgets a removed connection whose drain never ends, and only one already removed', async () => {
  const engines = new ConnectionEngines()
  const close = vi.fn(() => new Promise<void>(() => {}))
  const invalidate = vi.fn()
  engines.start(
    ['sample'],
    () => ({ start: async () => {}, close, invalidate }),
    () => {}
  )
  await engines.settled()
  engines.forget('sample')
  void engines.remove('sample')
  expect(invalidate).toHaveBeenCalledOnce()
  engines.forget('sample')
  // A second removal and the host shutdown no longer wait on the abandoned drain.
  await engines.remove('sample')
  await engines.close()
  expect(close).toHaveBeenCalledOnce()
})
