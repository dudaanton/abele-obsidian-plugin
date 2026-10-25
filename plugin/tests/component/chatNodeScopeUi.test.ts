import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, shallowRef } from 'vue'
import { Menu } from 'obsidian'
import type { ChatSession } from '@/ai/ChatSession'
import AiNodeScopeEditor from '@/components/AiNodeScopeEditor.vue'
import AiNodeScopeChips from '@/components/AiNodeScopeChips.vue'
import FolderAccessModal from '@/components/chatTree/FolderAccessModal.vue'
import Button from '@/components/obsidian/Button.vue'
import Icon from '@/components/obsidian/Icon.vue'
import { CHAT_TREE_SOURCE } from '@/chats/chatTree'
import { pendingNodeAccess } from '@/components/chat/nodeAccessPending'

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
  give: vi.fn(),
  remove: vi.fn(),
  approve: vi.fn(),
  approved: false,
  host: vi.fn(),
  picker: vi.fn(),
  choices: [] as { entry: unknown }[],
  pick: undefined as ((choice: { entry: unknown }) => void) | undefined,
}))
// The folder picker replaces nested Add menus; local approval controls were removed.
vi.mock('@/components/nodeFolderPicker', () => ({
  nodeFolderChoices: async (host: { nodes(): { id: string }[] }) =>
    host.nodes().map((n) => ({
      entry: { kind: 'project', node_id: n.id, project_id: 'sample-project', access: 'read' },
    })),
  NodeFolderPicker: class {
    constructor(
      _app: unknown,
      choices: { entry: unknown }[],
      pick: (choice: { entry: unknown }) => void
    ) {
      mocks.choices = choices
      mocks.pick = pick
    }
    open() {
      mocks.picker()
    }
  },
}))
vi.mock('@/ai/tools/node/owner', () => ({
  setObsidianChatNodeScope: mocks.set,
  giveObsidianChatAccess: mocks.give,
  removeObsidianChatNodeAccess: mocks.remove,
  approveObsidianChatNodeAccess: mocks.approve,
  nodeAgentHost: async () => {
    const host = await mocks.host()
    return {
      ...host,
      ledger: {
        approvedEntries: (session: ChatSession) =>
          mocks.approved
            ? [
                ...(session.overrides.value.nodeScope ?? []),
                ...(session.inheritedNodeScopes ?? []).flatMap((source) => source.entries),
              ]
            : [],
      },
      connection: (id: string) => ({
        ...host.connection(id),
        principal: () => 'sample-installation',
      }),
    }
  },
}))
const menus: Menu[] = []
vi.spyOn(Menu.prototype, 'showAtMouseEvent').mockImplementation(function () {
  menus.push(this)
  return this
})
beforeEach(() => {
  menus.length = 0
  mocks.approved = false
  mocks.approve.mockImplementation(async () => {
    mocks.approved = true
  })
  vi.clearAllMocks()
  pendingNodeAccess.value = null
})
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
async function icon(view: ReturnType<typeof mount>, glyph: string) {
  view
    .findAllComponents(Icon)
    .find((icon) => icon.props('icon') === glyph)!
    .vm.$emit('click', new MouseEvent('click'))
  await flushPromises()
}
async function choose(title: string) {
  const menu = menus.at(-1)!
  const item = menu.items.find((item) => item.title === title)!
  expect(item).toBeTruthy()
  item.handler!()
  await flushPromises()
}
describe('node scope beside vault scope and in the header', () => {
  it('keeps the quiet folder inheritance description above Nodes', () => {
    const view = mount(FolderAccessModal, {
      props: { name: 'Collection', floor: {}, access: {}, nodeScopeOwner: setup() },
      global: {
        stubs: {
          ObsidianModal: { template: '<div><slot /></div>' },
          AiNodeScopeEditor: true,
          ChatToolModes: true,
        },
      },
    })
    const description = view.get('.abele-folder-access__about')
    expect(description.text()).toBe('Every chat in this folder gets these on top of the default.')
    expect(description.classes()).toContain('setting-item-description')
    expect(description.element.nextElementSibling?.tagName.toLowerCase()).toBe(
      'ai-node-scope-editor-stub'
    )
    view.unmount()
  })
  it('shows disconnected grants as rows with a dot, without a contradictory empty state or approval block', async () => {
    const session = setup()
    mocks.host.mockResolvedValue({
      nodes: () => [],
      connection: () => {
        throw new Error('Not registered')
      },
    })
    const view = mount(AiNodeScopeEditor, { props: { session } })
    await flushPromises()
    expect(view.text()).not.toContain('No nodes connected here')
    expect(view.text()).not.toContain('Local approval')
    expect(view.find('.abele-status-dot_faint').exists()).toBe(true)
    expect(view.find('.abele-status-dot_orange').exists()).toBe(false)
    expect(view.findAllComponents(Icon).some((icon) => icon.props('icon') === 'shield-check')).toBe(
      false
    )
    view.unmount()
  })
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
      await flushPromises()
      await icon(view, 'server')
      await choose('sample')
      const option = menus
        .at(-1)!
        .items.find((item) => item.title.includes('Review sample parser'))!
      expect(option.title).not.toContain('11111111-1111-4111-8111-111111111111')
      if (branch.startsWith('work/')) expect(option.title).toContain(branch)
      view.unmount()
    }
  )
  it('explains whole-node future access without another device approval', async () => {
    const session = setup()
    const view = mount(AiNodeScopeEditor, { props: { session } })
    await flushPromises()
    expect(view.get('h3').attributes('aria-label')).toContain('vault access')
    expect(
      view
        .findAllComponents(Icon)
        .find((icon) => icon.props('icon') === 'server')!
        .props('tooltip')
    ).toContain('future')
    expect(mocks.approve).not.toHaveBeenCalled()
    expect(view.findAllComponents(Icon).some((icon) => icon.props('icon') === 'shield-check')).toBe(
      false
    )
    view.unmount()
  })
  it('offers node/folder/worktree levels with a read/edit choice', async () => {
    const view = mount(AiNodeScopeEditor, { props: { session: setup() } })
    await flushPromises()
    await icon(view, 'plus')
    expect(mocks.picker).toHaveBeenCalled()
    await icon(view, 'server')
    expect(menus.at(-1)!.items[0].title).toBe('Whole node')
    await icon(view, 'pencil')
    expect(menus.at(-1)!.items.map((item) => item.title)).toEqual([
      'read',
      'read and edit',
      'Read, edit and run commands',
    ])
    expect(menus.at(-1)!.items[1].checked).toBe(true)
    await choose('read')
    expect(mocks.give).toHaveBeenCalledWith(expect.anything(), {
      kind: 'node',
      node_id: 'sample-node',
      access: 'read',
    })
    view.unmount()
  })
  it('Add grants read only for the chosen entry, not the entire existing configuration', async () => {
    const session = setup()
    session.overrides.value.nodeScope = []
    const view = mount(AiNodeScopeEditor, { props: { session } })
    await flushPromises()
    await icon(view, 'plus')
    mocks.pick!(mocks.choices[0])
    await flushPromises()
    expect(mocks.give).toHaveBeenCalledWith(session, {
      kind: 'project',
      project_id: 'sample-project',
      node_id: 'sample-node',
      access: 'read',
    })
    expect(mocks.set).not.toHaveBeenCalled()
    view.unmount()
  })
  it('reads daemon permission availability once for folders on the same node', async () => {
    const session = setup()
    session.overrides.value.nodeScope = [
      { kind: 'project', node_id: 'sample-node', project_id: 'sample-first', access: 'run' },
      { kind: 'project', node_id: 'sample-node', project_id: 'sample-second', access: 'run' },
    ]
    const describe = vi.fn(async () => ({
      providers: [{ provider: 'claude', configuration: { permission_modes: ['manual'] } }],
    }))
    mocks.host.mockResolvedValue({
      nodes: () => [{ id: 'sample-node', label: 'Sample node' }],
      connection: () => ({ client: { connected: true, listProjects: async () => [], describe } }),
    })
    const view = mount(AiNodeScopeEditor, { props: { session } })
    await flushPromises()
    expect(describe).toHaveBeenCalledOnce()
    view.unmount()
  })
  it('shows the daemon bypass refusal for a run folder without device approval controls', async () => {
    const session = setup()
    session.overrides.value.nodeScope![0].access = 'run'
    Object.assign(session, { permissionMode: ref('allow-all') })
    mocks.host.mockResolvedValue({
      nodes: () => [{ id: 'sample-node', label: 'Sample node' }],
      connection: () => ({
        client: {
          connected: true,
          listProjects: async () => [],
          describe: async () => ({
            providers: [
              {
                provider: 'claude',
                available: true,
                configuration: { permission_modes: ['manual'] },
              },
              {
                provider: 'acp',
                available: true,
                configuration: { permission_modes: ['manual', 'bypassPermissions'] },
              },
              {
                provider: 'pi',
                available: false,
                configuration: { permission_modes: ['manual', 'bypassPermissions'] },
              },
            ],
          }),
        },
      }),
    })
    const view = mount(AiNodeScopeEditor, { props: { session } })
    await flushPromises()
    expect(view.text()).toContain('still asks before commands')
    expect(view.find('.abele-status-dot_orange').exists()).toBe(true)
    expect(mocks.approve).not.toHaveBeenCalled()
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
    expect(pendingNodeAccess.value).toBeNull()
    await icon(view, 'plus')
    mocks.pick!(mocks.choices[0])
    await flushPromises()
    expect(mocks.give).toHaveBeenCalledWith(session, {
      kind: 'project',
      node_id: 'sample-registration',
      project_id: 'sample-project',
      access: 'read',
    })
    view.unmount()
  })
  it('names folders and worktrees the way the node panel does, not by absolute path or full ref', async () => {
    const session = setup()
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
    await icon(view, 'server')
    expect(menus.at(-1)!.items.map((item) => item.title)).toEqual([
      'Whole node',
      'sample-app',
      '~/a/twin',
      '~/b/twin',
    ])
    await choose('sample-app')
    expect(menus.at(-1)!.items.map((item) => item.title)).toEqual([
      'Whole folder',
      'main · sample-app',
    ])
    view.unmount()
  })
  it('renders removable header access without silently approving it', async () => {
    const session = setup()
    const view = mount(AiNodeScopeChips, { props: { session } })
    await flushPromises()
    expect(view.text()).toContain('Sample node')
    await icon(view, 'x')
    expect(mocks.remove).toHaveBeenCalledWith(session, session.overrides.value.nodeScope![0])
    view.unmount()
  })
  it('shows a quiet empty state and opens the folder picker without grants', async () => {
    const session = setup()
    session.overrides.value.nodeScope = []
    mocks.host.mockResolvedValue({
      nodes: () => [],
      connection: () => {
        throw new Error('Not registered')
      },
    })
    const view = mount(AiNodeScopeEditor, { props: { session } })
    await flushPromises()
    expect(view.text()).toContain('No nodes connected here')
    await icon(view, 'plus')
    expect(mocks.picker).toHaveBeenCalled()
    expect(mocks.choices).toEqual([])
    view.unmount()
  })
  it('opens the source folder and keeps inherited mode and removal unavailable', async () => {
    const session = setup()
    const entries = session.overrides.value.nodeScope!
    session.overrides.value.nodeScope = []
    Object.assign(session, {
      inheritedNodeScopes: [{ identity: 'sample-folder', folder: 'Collection', entries }],
    })
    const folderAccess = vi.fn()
    const view = mount(AiNodeScopeEditor, {
      props: { session },
      global: { provide: { [CHAT_TREE_SOURCE as symbol]: shallowRef({ folderAccess }) } },
    })
    await flushPromises()
    const mode = view.findAllComponents(Icon).find((icon) => icon.props('icon') === 'pencil')!
    expect(mode.props('interactive')).toBe(false)
    expect(mode.props('tooltip')).toContain('Change it in the folder')
    expect(view.findAllComponents(Icon).some((icon) => icon.props('icon') === 'x')).toBe(false)
    await icon(view, 'folder')
    expect(folderAccess).toHaveBeenCalledWith('Collection')
    view.unmount()
  })
})
