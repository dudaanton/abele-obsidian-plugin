import { expect, it, vi } from 'vitest'
import { disconnectNodeDevice } from '@/node/disconnectNodeDevice'
it('allows explicitly disclosed local removal when an offline node cannot describe support', async () => {
  const remove = vi.fn(),
    request = vi.fn()
  await disconnectNodeDevice(
    {
      describe: async () => {
        throw Error('offline')
      },
      request,
    },
    async (revokes) => {
      expect(revokes).toBe(false)
      return true
    },
    remove
  )
  expect(request).not.toHaveBeenCalled()
  expect(remove).toHaveBeenCalledOnce()
})
it.each([true, false])(
  'revokes only supported devices before removing their registration: %s',
  async (supported) => {
    const order: string[] = []
    const client = {
      describe: async () => ({
        capabilities: {
          capabilities: { device_disconnect: { status: supported ? 'supported' : 'unsupported' } },
        },
      }),
      request: vi.fn(async (method: string, params: unknown) => {
        expect(method).toBe('node.disconnect')
        expect(params).toEqual({})
        order.push('revoke')
        return { disconnected: true }
      }),
    }
    await disconnectNodeDevice(
      client,
      async (advertised) => {
        expect(advertised).toBe(supported)
        return true
      },
      () => order.push('remove')
    )
    expect(order).toEqual(supported ? ['revoke', 'remove'] : ['remove'])
  }
)
it('keeps registration after cancellation, failure or lost acknowledgement', async () => {
  const remove = vi.fn()
  const client = {
    describe: async () => ({
      capabilities: { capabilities: { device_disconnect: { status: 'supported' } } },
    }),
    request: vi.fn(async () => {
      throw Error('disconnected')
    }),
  }
  await disconnectNodeDevice(client, async () => false, remove)
  expect(client.request).not.toHaveBeenCalled()
  await expect(disconnectNodeDevice(client, async () => true, remove)).rejects.toThrow(
    'disconnected'
  )
  expect(remove).not.toHaveBeenCalled()
})
