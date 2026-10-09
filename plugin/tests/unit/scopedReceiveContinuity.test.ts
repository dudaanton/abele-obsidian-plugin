import { expect, it } from 'vitest'
import { AbeleError } from '@abele/sync-protocol'
import { receiveDespiteRejectedItems } from '@/sync/scoped/receiveContinuity'

it('holds individual protected-group, quota and stale-proof items and continues receiving', async () => {
  for (const code of ['forbidden', 'quota_exceeded', 'stale_base'] as const) {
    const events: string[] = []
    await receiveDespiteRejectedItems({
      pending: async () => false,
      items: async () => ['blocked', 'good'],
      blocked: async () => false,
      send: async (item) => {
        events.push('send:' + item)
        if (item === 'blocked') throw new AbeleError(code, 'sample refusal')
      },
      hold: async (item) => {
        events.push('hold:' + item)
      },
      receive: async () => {
        events.push('receive')
      },
      report: () => {},
    })
    expect(events).toEqual(['send:blocked', 'hold:blocked', 'send:good', 'receive'])
  }
})

it('does not treat a refusal during uncertain replay as proof the original request never committed', async () => {
  const events: string[] = []
  await receiveDespiteRejectedItems({
    pending: async () => true,
    items: async () => ['next'],
    blocked: async () => false,
    send: async (item) => {
      events.push(item)
      throw new AbeleError('forbidden', 'authority changed after response loss')
    },
    hold: async () => {
      events.push('archived')
    },
    receive: async () => {
      events.push('receive')
    },
    report: () => {},
  })
  expect(events).toEqual(['replay', 'receive'])
})

it('retains an uncertain request and receives without sending later items over its identity', async () => {
  const events: string[] = []
  await receiveDespiteRejectedItems({
    pending: async () => true,
    items: async () => ['next'],
    blocked: async () => false,
    send: async (item) => {
      events.push(item)
      throw new Error('response lost')
    },
    hold: async () => {
      events.push('discarded')
    },
    receive: async () => {
      events.push('receive')
    },
    report: () => {},
  })
  expect(events).toEqual(['replay', 'receive'])
})
