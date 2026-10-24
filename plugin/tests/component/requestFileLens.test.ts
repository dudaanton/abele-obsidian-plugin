import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { computed, defineComponent, h, shallowRef } from 'vue'
import { NodeRequestFiles } from '@/requests/nodeFiles'
import { WORKING_TREE } from '@/repository/node'
import type { NodeRepositoryTarget } from '@/repository/nodeLinks'
import { useFileRequests } from '@/requests/useFileRequests'

const service = vi.hoisted(() => ({ model: vi.fn() }))
vi.mock('@/requests/RequestsService', () => ({ RequestsService: { instance: () => service } }))
vi.mock('@/requests/actions', () => ({
  openRequestTab: vi.fn(),
  say: vi.fn(),
  sendFromView: vi.fn(),
}))

it('acquires file-request watches only for live request files and releases them on navigation', async () => {
  const stop = vi.fn()
  const port = Object.assign(Object.create(NodeRequestFiles.prototype), { matches: () => true })
  const model = {
    files: { port },
    followFiles: vi.fn(() => stop),
    refreshFiles: vi.fn(async () => {}),
  }
  service.model.mockReturnValue(model)
  const target = shallowRef<NodeRepositoryTarget>({
    provider: 'node',
    source: {
      provider: 'node',
      installation: 'sample-installation',
      node: 'sample-node',
      project: 'sample-project',
      workspace: 'sample-copy',
    },
    location: { kind: 'file', ref: WORKING_TREE, path: 'sample.ts' },
  })
  const view = mount(
    defineComponent({
      setup() {
        const lens = useFileRequests(computed(() => target.value))
        return () => h('div', String(lens.available.value))
      },
    })
  )
  try {
    await flushPromises()
    expect(service.model).not.toHaveBeenCalled()
    expect(model.followFiles).not.toHaveBeenCalled()
    target.value = {
      ...target.value,
      location: { kind: 'file', ref: WORKING_TREE, path: 'sample.http' },
    }
    await flushPromises()
    expect(view.text()).toBe('true')
    expect(model.followFiles).toHaveBeenCalledOnce()
    expect(model.refreshFiles).toHaveBeenCalledOnce()
    target.value = {
      ...target.value,
      location: { kind: 'file', ref: WORKING_TREE, path: 'sample.ts' },
    }
    await flushPromises()
    expect(view.text()).toBe('false')
    expect(stop).toHaveBeenCalledOnce()
    const calls = service.model.mock.calls.length
    target.value = {
      ...target.value,
      location: { kind: 'file', ref: 'sample-commit', path: 'sample.http' },
    }
    await flushPromises()
    expect(service.model).toHaveBeenCalledTimes(calls)
    expect(view.text()).toBe('false')
    target.value = {
      ...target.value,
      location: { kind: 'file', ref: WORKING_TREE, path: 'sample.rest' },
    }
    await flushPromises()
    expect(view.text()).toBe('true')
    expect(model.followFiles).toHaveBeenCalledTimes(2)
  } finally {
    view.unmount()
  }
  expect(stop).toHaveBeenCalledTimes(2)
})
