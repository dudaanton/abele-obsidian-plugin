import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import type { ChatSession } from '@/ai/ChatSession'
import AiNodeScopeEditor from '@/components/AiNodeScopeEditor.vue'
import AiNodeScopeChips from '@/components/AiNodeScopeChips.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import Button from '@/components/obsidian/Button.vue'
import Icon from '@/components/obsidian/Icon.vue'
import { pendingNodeAccess } from '@/components/chat/nodeAccessPending'

const mocks = vi.hoisted(() => ({ set: vi.fn(), give: vi.fn(), remove: vi.fn(), host: vi.fn() }))
vi.mock('@/ai/tools/node/owner', () => ({
  setObsidianChatNodeScope: mocks.set,
  giveObsidianChatAccess: mocks.give,
  removeObsidianChatNodeAccess: mocks.remove,
  nodeAgentHost: mocks.host,
}))
function setup() {
  const session = {
    overrides: ref({ nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'edit' }] }),
  } as unknown as ChatSession
  mocks.host.mockResolvedValue({
    nodes: () => [{ id: 'sample-node', label: 'Sample node' }],
    connection: () => ({ client: { connected: true, listProjects: async () => [] } }),
  })
  return session
}
describe('node scope beside vault scope and in the header', () => {
  it.each(['work/sample-parser', 'abele/11111111-1111-4111-8111-111111111111'])(
    'names a developer worktree by its parent task and meaningful branch (%s)',
    async (branch) => {
      const session = setup()
      Object.assign(session, { delegationParentId: 'sample-parent' })
      mocks.host.mockResolvedValue({
        nodes: () => [{ id: 'sample-node', label: 'Sample node' }],
        connection: () => ({
          childTitle: (parent: string, workspace: string) =>
            parent === 'sample-parent' && workspace === 'sample-copy'
              ? 'Review sample parser'
              : undefined,
          client: {
            connected: true,
            listProjects: async () => [
              { project_id: 'sample-project', root_path: '/sample', repository_path: '/sample' },
            ],
            repository: {
              worktrees: async () => ({
                entries: [
                  {
                    worktree_id: 'sample-tree',
                    workspace_id: 'sample-copy',
                    branch,
                    path_label: '/sample-copy',
                  },
                ],
                cursor: null,
              }),
            },
          },
        }),
      })
      pendingNodeAccess.value = { node_id: 'sample-node', project_id: 'sample-project' }
      const view = mount(AiNodeScopeEditor, { props: { session } })
      try {
        await flushPromises()
        const option = view
          .findAllComponents(Dropdown)
          .flatMap((dropdown) => dropdown.props('options'))
          .find((option: { value: string }) => option.value === 'sample-tree')
        expect(option.display).toContain('Review sample parser')
        expect(option.display).not.toContain('11111111-1111-4111-8111-111111111111')
        if (branch.startsWith('work/')) expect(option.display).toContain(branch)
      } finally {
        view.unmount()
      }
    }
  )
  it('explains whole-node future access, keeps it separate from vault access, and approves loaded settings locally', async () => {
    const session = setup()
    const view = mount(AiNodeScopeEditor, { props: { session } })
    await flushPromises()
    expect(view.text()).toContain('future registered folders')
    expect(view.text()).toContain('vault access')
    const approve = view
      .findAllComponents(Button)
      .find((button) => button.props('text') === 'Approve on this device')!
    approve.vm.$emit('click')
    await flushPromises()
    expect(mocks.set).toHaveBeenCalledWith(session, session.overrides.value.nodeScope)
    view.unmount()
  })
  it('offers node/folder/worktree levels with a read/edit choice', async () => {
    const view = mount(AiNodeScopeEditor, { props: { session: setup() } })
    await flushPromises()
    const nodes = view.findAllComponents(Dropdown)[0]
    expect(nodes.props('options')).toContainEqual({ value: 'sample-node', display: 'Sample node' })
    nodes.vm.$emit('update:model-value', 'sample-node')
    await flushPromises()
    expect(view.text()).toContain('Whole node')
    expect(
      view
        .findAllComponents(Dropdown)
        .some((dropdown) =>
          dropdown.props('options').some((option: { value: string }) => option.value === 'edit')
        )
    ).toBe(true)
    view.unmount()
  })
  it('Add confirms only the chosen entry, not the entire existing configuration', async () => {
    const session = setup(),
      prior = mocks.set.mock.calls.length
    const view = mount(AiNodeScopeEditor, { props: { session } })
    await flushPromises()
    view.findAllComponents(Dropdown)[0].vm.$emit('update:model-value', 'sample-node')
    await flushPromises()
    view
      .findAllComponents(Button)
      .find((button) => button.props('text') === 'Add access')!
      .vm.$emit('click')
    await flushPromises()
    expect(mocks.give).toHaveBeenCalledWith(session, {
      kind: 'node',
      node_id: 'sample-node',
      access: 'edit',
    })
    expect(mocks.set.mock.calls).toHaveLength(prior)
    view.unmount()
  })
  it('keeps malformed synced scope visible as an error rather than crashing the chat', async () => {
    const session = setup()
    session.overrides.value.nodeScope = [{ kind: 'invalid', node_id: 'sample-node' }] as never
    const view = mount(AiNodeScopeEditor, { props: { session } })
    await flushPromises()
    expect(view.text()).toContain('Invalid node scope')
    expect(
      view.findAllComponents(Button).some((button) => button.props('text') === 'Clear node access')
    ).toBe(true)
    view.unmount()
  })
  it('opens on the place a refused call wanted, its node found by the id the node knows itself by', async () => {
    const session = setup()
    session.overrides.value.nodeScope = []
    mocks.host.mockResolvedValue({
      nodes: () => [{ id: 'sample-registration', node_id: 'sample-node', label: 'Sample node' }],
      connection: () => ({
        client: {
          connected: true,
          listProjects: async () => [
            { project_id: 'sample-project', root_path: '/sample', repository_path: null },
          ],
          listWorkspaces: async () => [],
        },
      }),
    })
    pendingNodeAccess.value = { node_id: 'sample-node', project_id: 'sample-project' }
    const view = mount(AiNodeScopeEditor, { props: { session } })
    await flushPromises()
    const [node, folder] = view.findAllComponents(Dropdown)
    expect(node.props('modelValue')).toBe('sample-registration')
    expect(folder.props('modelValue')).toBe('sample-project')
    expect(pendingNodeAccess.value).toBeNull()
    view.unmount()
  })
  it('names folders and worktrees the way the node panel does, not by absolute path or full ref', async () => {
    const session = setup()
    session.overrides.value.nodeScope = []
    mocks.host.mockResolvedValue({
      nodes: () => [{ id: 'sample-registration', node_id: 'sample-node', label: 'Sample node' }],
      connection: () => ({
        client: {
          connected: true,
          listProjects: async () => [
            {
              project_id: 'p1',
              root_path: '/Users/username/work/sample-app',
              repository_path: '/x',
            },
            { project_id: 'p2', root_path: '/Users/username/a/twin', repository_path: null },
            { project_id: 'p3', root_path: '/Users/username/b/twin', repository_path: null },
          ],
          listWorkspaces: async () => [],
          repository: {
            worktrees: async () => ({
              entries: [{ worktree_id: 'w1', branch: 'refs/heads/main', path_label: 'sample-app' }],
              cursor: null,
            }),
          },
        },
      }),
    })
    pendingNodeAccess.value = { node_id: 'sample-node', project_id: 'p1' }
    const view = mount(AiNodeScopeEditor, { props: { session } })
    await flushPromises()
    const [, folder, worktree] = view.findAllComponents(Dropdown)
    const shown = (d: typeof folder) =>
      (d.props('options') as { display: string }[]).map((o) => o.display)
    expect(shown(folder)).toEqual(['Whole node', 'sample-app', '~/a/twin', '~/b/twin'])
    expect(shown(worktree)).toEqual(['Whole folder', 'main · sample-app'])
    view.unmount()
  })
  it('renders removable header access without silently approving it', async () => {
    const session = setup()
    const view = mount(AiNodeScopeChips, { props: { session } })
    await flushPromises()
    expect(view.text()).toContain('Sample node')
    const remove = view.findAllComponents(Icon).find((icon) => icon.props('icon') === 'x')!
    remove.vm.$emit('click')
    await flushPromises()
    expect(mocks.remove).toHaveBeenCalledWith(session, session.overrides.value.nodeScope![0])
    view.unmount()
  })
})
