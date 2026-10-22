import { expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nodePathAction } from '@/node/NodePathController'
import { nodeErrorNotice } from '@/node/errorNotice'
vi.mock('@/node/errorNotice', () => ({ nodeErrorNotice: vi.fn() }))
it('reports a visible action failure inline and only notifies when there is no visible result', async () => {
  const error = new Error('sample_failure'),
    report = vi.fn()
  nodePathAction(() => Promise.reject(error), report)
  await flushPromises()
  expect(report).toHaveBeenCalledWith(error)
  expect(nodeErrorNotice).not.toHaveBeenCalled()
  nodePathAction(() => Promise.reject(error))
  await flushPromises()
  expect(nodeErrorNotice).toHaveBeenCalledOnce()
})
