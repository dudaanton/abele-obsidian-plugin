import { afterEach, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { Platform } from 'obsidian'
import { NodeSidebarView } from '@/views/NodeSidebarView'
vi.mock('@/node/NodeService', () => ({
  NodeService: { getInstance: () => ({ nodes: { value: [] } }) },
}))
afterEach(() => {
  Platform.isMobile = false
})
it('rechecks local discovery when an existing desktop pane is reopened', async () => {
  Platform.isMobile = false
  const view = Object.create(NodeSidebarView.prototype) as NodeSidebarView
  const local = shallowRef(),
    localPhase = shallowRef('not-found'),
    discover = vi.fn(() => ({ endpoint: 'ws://127.0.0.1:4123/channel' }))
  Object.assign(view, {
    registrationId: shallowRef(''),
    local,
    localPhase,
    discovery: { discover },
    app: { loadLocalStorage: () => '/sample/node-state' },
  })
  await view.setState({}, {} as never)
  expect(discover).toHaveBeenCalledWith('/sample/node-state')
  expect(localPhase.value).toBe('found')
  localPhase.value = 'connecting'
  discover.mockClear()
  await view.setState({}, {} as never)
  expect(discover).not.toHaveBeenCalled()
  Platform.isMobile = true
  localPhase.value = 'remote'
  await view.setState({}, {} as never)
  expect(discover).not.toHaveBeenCalled()
})
