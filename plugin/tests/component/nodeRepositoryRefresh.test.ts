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

it('refreshes file, tree, search, catalogue and editing permission after a redacted catalogue hint', async () => {
  useVault([])
  const f = nodeRepositoryFixture(),
    store = new MemoryClientStore()
  await store.transaction((s) => {
    s.node_id = identity.node
    s.installation_id = identity.installation
  })
  let enabled = true,
    label = 'worktrees-feature'
  const catalog = f.client.repository.worktrees.bind(f.client.repository)
  f.client.repository.worktrees = vi.fn(async (params) => {
    const page = await catalog(params)
    page.entries[1].path_label = label
    return page
  })
  f.client.repository.editingStatus = vi.fn(async (params) => ({ ...params, enabled }))
  const client = {
    ...f.client,
    store,
    target: { expected_node_id: identity.node },
    getProject: vi.fn(async () => ({ project_id: identity.project, root_path: '/sample/project' })),
    onEvent: (listener: Parameters<typeof f.client.onEvent>[0]) =>
      f.client.onEvent((event) => {
        if (event.type !== 'repository.invalidated') listener(event)
      }),
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
      source: { ...identity, workspace: 'external-fixture' },
      location: { kind: 'file' as const, ref: WORKING_TREE, path: 'app.ts' },
    },
    url: '',
    target: null,
    nonce: 0,
    tree: true,
    screen: emptyScreen(),
  })
  const onTitle = vi.fn()
  const wrapper = mount(NodeRepositoryItem, { props: { model, onTitle } })
  try {
    await flushPromises()
    await wrapper
      .find('[aria-label="Search the code: this change, the whole repository, or file names"]')
      .trigger('click')
    await wrapper.find('.abele-github-search input').setValue('answer')
    await wrapper.find('.abele-github-search input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.findAllComponents(GithubCode).at(-1)!.props('editable')).toBe(true)
    const count = (suffix: string) => f.calls.filter((c) => c.method.endsWith(suffix)).length
    const before = {
      blob: count('.blob'),
      tree: count('.tree'),
      search: count('.search'),
      catalog: count('.worktrees'),
      permission: vi.mocked(f.client.repository.editingStatus).mock.calls.length,
    }
    enabled = false
    label = 'updated-worktree-label'
    f.change()
    f.event('stream.redacted', { refresh_required: true })
    await flushPromises()
    expect(wrapper.findAllComponents(GithubCode).at(-1)!.props('text')).toContain('84')
    expect(wrapper.findAllComponents(GithubCode).at(-1)!.props('editable')).toBe(false)
    expect(count('.blob')).toBeGreaterThan(before.blob)
    expect(count('.tree')).toBeGreaterThan(before.tree)
    expect(count('.search')).toBeGreaterThan(before.search)
    expect(count('.worktrees')).toBeGreaterThan(before.catalog)
    expect(onTitle).toHaveBeenCalledWith('project · updated-worktree-label')
    expect(vi.mocked(f.client.repository.editingStatus).mock.calls.length).toBeGreaterThan(
      before.permission
    )
    expect((wrapper.find('.abele-github-search input').element as HTMLInputElement).value).toBe(
      'answer'
    )
  } finally {
    wrapper.unmount()
    singleton.mockRestore()
  }
})
