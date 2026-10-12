import { afterEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { type WorkspaceLeaf, Platform } from 'obsidian'
import { NodeService } from '@/node/NodeService'
import { NodeSidebarView } from '@/views/NodeSidebarView'

vi.mock('@/node/NodeService', () => ({ NodeService: { getInstance: vi.fn() } }))
vi.mock('@/node/NodePathService', () => ({
  NodePathService: { getInstance: () => ({ model: () => undefined }) },
}))
vi.mock('@/node/NodePathController', () => ({ openNodePathPairing: vi.fn() }))
vi.mock('@/node/localDiscovery', () => ({
  createLocalNodeDiscovery: () => ({ discover: () => undefined }),
}))
vi.mock('@/components/nodeWork/NodePathSidebar.vue', () => ({ default: { render: () => null } }))

afterEach(() => {
  Platform.isMobile = false
})
describe('node sidebar layout state', () => {
  it.each([false, true])(
    'retains a registered node after onOpen then empty setState (mobile=%s)',
    async (mobile) => {
      Platform.isMobile = mobile
      const nodes = shallowRef([{ id: 'sample-registration' }])
      vi.mocked(NodeService.getInstance).mockReturnValue({
        nodes,
        connection: () => undefined,
      } as never)
      const view = new NodeSidebarView({} as WorkspaceLeaf)
      Object.assign(view, {
        contentEl: view.containerEl.children[1],
        app: { loadLocalStorage: () => undefined },
      })
      await view.onOpen()
      expect(view.getState()).toEqual({ registrationId: 'sample-registration' })
      await view.setState({}, {})
      expect(view.getState()).toEqual({ registrationId: 'sample-registration' })
      await view.onClose()
    }
  )
  it('honours an explicit saved selection and replaces missing registrations', async () => {
    const nodes = shallowRef([{ id: 'first-registration' }, { id: 'second-registration' }])
    vi.mocked(NodeService.getInstance).mockReturnValue({ nodes } as never)
    const view = new NodeSidebarView({} as WorkspaceLeaf)
    await view.setState({ registrationId: 'second-registration' }, {})
    expect(view.getState()).toEqual({ registrationId: 'second-registration' })
    await view.setState({ registrationId: 'removed-registration' }, {})
    expect(view.getState()).toEqual({ registrationId: 'first-registration' })
    nodes.value = []
    await view.setState({}, {})
    expect(view.getState()).toEqual({})
  })
})
