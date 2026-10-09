import { expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { MemoryClientStore } from '@abele/node-client'
import NodeRepositoryItem from '@/components/NodeRepositoryItem.vue'
import { NodeService } from '@/node/NodeService'
import { createNodeTools, nodeRepositoryToolsHost } from '@/ai/tools/node'
import { openNodeRepository } from '@/node/openRepository'
import { emptyScreen } from '@/github/screen'
import { useVault } from '../helpers/testEnv'
import { nodeRepositoryFixture, identity, HEAD } from '../helpers/nodeRepositoryFixture'
import type { ChatSession } from '@/ai/ChatSession'
import type { ToolContext } from '@/ai/toolContext'
import type { GithubViewModel } from '@/github/model'

vi.mock('@/node/openRepository', () => ({
  openNodeRepository: vi.fn(async () => ({})),
  openNodeRepositoryTarget: vi.fn(),
}))
it('attaches the mounted node view to agent tools and removes it when the view closes', async () => {
  useVault([])
  const f = nodeRepositoryFixture(),
    store = new MemoryClientStore()
  await store.transaction((state) => {
    state.node_id = identity.node
    state.installation_id = identity.installation
  })
  const client = {
    ...f.client,
    store,
    target: { expected_node_id: identity.node },
    getProject: async () => ({ root_path: '/sample/sample-project' }),
  }
  const connection = {
    client,
    state: ref('connected'),
    authorizationGeneration: 0,
    connect: async () => {},
  }
  const service = {
    nodes: ref([{ id: identity.node, expectedNodeId: identity.node, label: 'Sample node' }]),
    connection: () => connection,
  }
  const instance = vi.spyOn(NodeService, 'getInstance').mockReturnValue(service as any)
  const model: GithubViewModel = reactive({
    url: '',
    target: null,
    sourceTarget: {
      provider: 'node',
      source: identity,
      location: { kind: 'home', ref: 'Working tree' },
    },
    nonce: 0,
    tree: false,
    screen: emptyScreen(),
  })
  const wrapper = mount(NodeRepositoryItem, { props: { model } })
  const session = {} as ChatSession
  try {
    await flushPromises()
    const tab = [...nodeRepositoryToolsHost.tabs].find(
      (tab) =>
        tab.source.identity.provider === 'node' &&
        tab.source.identity.workspace === identity.workspace
    )!
    expect(tab).toBeDefined()
    expect(nodeRepositoryToolsHost.authorized(session, tab)).toBe(false)
    nodeRepositoryToolsHost.grant(session, identity.node, identity.project, tab)
    const tool = createNodeTools().find((tool) => tool.name === 'node_open')!
    await tool.execute(
      'sample-navigation',
      {
        node: identity.node,
        project: identity.project,
        workspace: identity.workspace,
        path: 'app.ts',
        revision: HEAD,
      },
      undefined,
      { session } as ToolContext
    )
    expect(openNodeRepository).toHaveBeenCalledWith(
      identity.node,
      identity.project,
      identity.workspace,
      { path: 'app.ts', revision: HEAD }
    )
    wrapper.unmount()
    expect(nodeRepositoryToolsHost.tabs.has(tab)).toBe(false)
  } finally {
    if (wrapper.exists()) wrapper.unmount()
    nodeRepositoryToolsHost.revokeAll(session)
    instance.mockRestore()
  }
})
