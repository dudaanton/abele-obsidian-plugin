import { expect, it, vi } from 'vitest'
const connection = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('missing node')
  })
)
vi.mock('@/node/NodeService', () => ({
  NodeService: { getInstance: () => ({ nodes: { value: [] }, connection }) },
}))
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: {
    getInstance: () => ({ app: { loadLocalStorage: () => undefined, saveLocalStorage: () => {} } }),
  },
}))
import { RequestsService } from '@/requests/RequestsService'

it('can restore a request tab whose node was removed without creating a file client', () => {
  try {
    expect(() =>
      RequestsService.instance().model({
        registrationId: 'missing-node',
        projectId: 'sample-project',
      })
    ).not.toThrow()
    expect(connection).not.toHaveBeenCalled()
  } finally {
    RequestsService.destroy()
  }
})
