import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, reactive } from 'vue'
import { MemoryClientStore } from '@abele/node-client'
import NodeRepositoryItem from '@/components/NodeRepositoryItem.vue'
import GithubCode from '@/components/github/GithubCode.vue'
import { NodeService } from '@/node/NodeService'
import { emptyScreen } from '@/github/screen'
import { WORKING_TREE } from '@/repository/node'
import { nodeRepositoryFixture, identity } from '../helpers/nodeRepositoryFixture'
import { useVault } from '../helpers/testEnv'

it('rereads the open file from a change batch only when it changed, and reads no tree of its own', async () => {
  useVault([])
  const f = nodeRepositoryFixture({ changes: true }),
    store = new MemoryClientStore()
  await store.transaction((s) => {
    s.node_id = identity.node
    s.installation_id = identity.installation
  })
  const client = {
    ...f.client,
    store,
    target: { expected_node_id: identity.node },
    getProject: vi.fn(async () => ({ project_id: identity.project, root_path: '/sample/project' })),
  }
  const connection = {
    client,
    state: ref('connected'),
    authorizationGeneration: 0,
    connect: vi.fn(async () => {}),
  }
  const service = {
    nodes: ref([{ id: identity.node, expectedNodeId: identity.node, label: 'Sample node' }]),
    connection: () => connection,
  }
  const singleton = vi.spyOn(NodeService, 'getInstance').mockReturnValue(service as never)
  const model = reactive({
    sourceTarget: {
      provider: 'node' as const,
      source: identity,
      location: { kind: 'file' as const, ref: WORKING_TREE, path: 'app.ts' },
    },
    url: '',
    target: null,
    nonce: 0,
    tree: true,
    screen: emptyScreen(),
  })
  const wrapper = mount(NodeRepositoryItem, { props: { model, onTitle: vi.fn() } })
  try {
    await flushPromises()
    // The node's files are in its side panel (its batches are applied there, see
    // nodePathChanges.test.ts); the tab has no tree beside the file.
    expect(wrapper.find('.abele-github-tree').exists()).toBe(false)
    const count = (suffix: string) => f.calls.filter((c) => c.method.endsWith(suffix)).length
    const before = { blob: count('.blob'), tree: count('.tree') }
    f.batch(1, {
      complete: true,
      entries: [
        {
          change: 'added',
          entry: { path: 'other.ts', name: 'other.ts', kind: 'file', oid: null, size: 3 },
        },
      ],
      git: null,
    })
    await flushPromises()
    // A file that is not the open one changed: nothing is read again.
    expect(count('.blob')).toBe(before.blob)
    expect(count('.tree')).toBe(before.tree)
    f.change()
    f.batch(2, {
      complete: true,
      entries: [
        {
          change: 'modified',
          entry: { path: 'app.ts', name: 'app.ts', kind: 'file', oid: null, size: 25 },
        },
      ],
      git: null,
    })
    await flushPromises()
    expect(wrapper.findAllComponents(GithubCode).at(-1)!.props('text')).toContain('84')
    // The open file is read again; no tree is.
    expect(count('.blob')).toBeGreaterThan(before.blob)
    expect(count('.tree')).toBe(before.tree)
  } finally {
    wrapper.unmount()
    singleton.mockRestore()
  }
})
