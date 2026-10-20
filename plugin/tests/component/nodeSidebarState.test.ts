import { afterEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { type WorkspaceLeaf, Platform } from 'obsidian'
import { NodeService } from '@/node/NodeService'
import { NodeSidebarView } from '@/views/NodeSidebarView'
import { flushPromises } from '@vue/test-utils'

const f = vi.hoisted(() => ({ model: undefined as unknown, file: undefined as string | undefined }))

vi.mock('@/node/NodeService', () => ({ NodeService: { getInstance: vi.fn() } }))
vi.mock('@/node/NodePathService', () => ({
  NodePathService: { getInstance: () => ({ model: () => f.model }) },
}))
vi.mock('@/node/NodePathController', () => ({ openNodePathPairing: vi.fn() }))
vi.mock('@/node/localDiscovery', () => ({
  createLocalNodeDiscovery: () => ({ discover: () => undefined }),
}))
vi.mock('@/components/nodeWork/NodePathSidebar.vue', () => ({
  default: {
    props: ['file'],
    render(this: { file?: string }) {
      f.file = this.file
      return null
    },
  },
}))

afterEach(() => {
  Platform.isMobile = false
  f.model = undefined
  f.file = undefined
})
describe('node sidebar layout state', () => {
  it('follows the main node file and ignores a file from another worktree', async () => {
    const target = {
      nodeId: 'sample-node',
      registrationId: 'sample-registration',
      projectId: 'sample-project',
      kind: 'worktree' as const,
      id: 'sample-worktree',
    }
    f.model = { current: shallowRef(target) }
    vi.mocked(NodeService.getInstance).mockReturnValue({
      nodes: shallowRef([{ id: target.registrationId }]),
      connection: () => undefined,
    } as never)
    let state = { kind: 'file', target, path: 'src/new-file.ts' }
    const listeners: Record<string, () => void> = {}
    const view = new NodeSidebarView({} as WorkspaceLeaf)
    Object.assign(view, {
      contentEl: view.containerEl.children[1],
      app: {
        loadLocalStorage: () => undefined,
        workspace: {
          rootSplit: {},
          getMostRecentLeaf: () => ({ getViewState: () => ({ type: 'abele-node-file', state }) }),
          on: (event: string, run: () => void) => {
            listeners[event] = run
            return {}
          },
        },
      },
    })
    await view.onOpen()
    await flushPromises()
    expect(f.file).toBe('src/new-file.ts')
    state = { ...state, target: { ...target, id: 'other-worktree' } }
    listeners['layout-change']()
    await flushPromises()
    expect(f.file).toBeUndefined()
    await view.onClose()
  })
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
        app: {
          loadLocalStorage: () => undefined,
          workspace: { rootSplit: {}, getMostRecentLeaf: () => null, on: () => ({}) },
        },
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
    Object.assign(view, { app: { loadLocalStorage: () => undefined } })
    await view.setState({ registrationId: 'second-registration' }, {})
    expect(view.getState()).toEqual({ registrationId: 'second-registration' })
    await view.setState({ registrationId: 'removed-registration' }, {})
    expect(view.getState()).toEqual({ registrationId: 'first-registration' })
    nodes.value = []
    await view.setState({}, {})
    expect(view.getState()).toEqual({})
  })
})
