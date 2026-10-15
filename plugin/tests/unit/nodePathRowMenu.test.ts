import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { Menu } from 'obsidian'
import { showNodePathPlaceMenu } from '@/node/NodePathController'

const f = vi.hoisted(() => ({
  request: vi.fn<(method: string, params: unknown) => Promise<unknown>>(),
  settings: vi.fn(async () => ({})),
  refresh: vi.fn(async () => {}),
}))
vi.mock('@/stores/GlobalStore', () => ({ GlobalStore: { getInstance: () => ({ app: {} }) } }))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      nodes: ref([]),
      connection: () => ({
        state: ref('connected'),
        client: {
          request: f.request,
          setRepositorySettings: f.settings,
          getProject: async () => ({ use_repository_claude_permissions: false }),
        },
      }),
    }),
  },
}))
vi.mock('@/node/NodePathOwnerActions', () => ({
  nodePathOwnerActions: () => ({ ask: vi.fn(), add: vi.fn(), grant: vi.fn() }),
  freezeNodePathContext: (c: unknown) => c,
}))
vi.mock('@/components/obsidian/dialogs', () => ({ confirmDialog: async () => true }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const target = {
  registrationId: 'sample-registration',
  nodeId: 'sample-node',
  projectId: 'sample-project',
  kind: 'worktree' as const,
  id: 'sample-root',
}
function model() {
  return {
    registrationId: target.registrationId,
    capabilities: ref(['node_path_v2', 'node_path_worktrees']),
    folders: ref([
      {
        id: 'sample-project',
        path: '/sample/project',
        git: true,
        copies: [{ id: 'sample-root', kind: 'project', branch: 'trunk', path: '/sample/project' }],
      },
    ]),
    target: () => target,
    selected: ref('sample-root'),
    current: ref(target),
    currentFolder: ref({ id: 'sample-project', git: true }),
    port: { branch: vi.fn() },
    refresh: f.refresh,
  } as never
}
type Shown = { items: { title: string; checked: boolean | null; handler: (() => void) | null }[] }
async function opened(): Promise<Shown> {
  const show = vi.spyOn(Menu.prototype, 'showAtPosition')
  showNodePathPlaceMenu(model(), new MouseEvent('click'), () => {})
  await vi.waitFor(() => expect(show).toHaveBeenCalled())
  return show.mock.instances[0] as unknown as Shown
}
const allow = (menu: Shown) =>
  menu.items.find((i) => i.title === 'Allow external workspace browsing')!

describe('the place menu', () => {
  it('starts with a new chat and switching place, then the folder’s items, then the node', async () => {
    f.request.mockResolvedValue({ project_id: 'sample-project', external_read: false })
    const titles = (await opened()).items.map((i) => i.title)
    expect(titles.slice(0, 3)).toEqual([
      'New chat here',
      'Switch to another branch…',
      'Compare with…',
    ])
    expect(titles).toContain('New worktree')
    expect(titles).toContain('Open a folder…')
    expect(titles).toContain('Refresh')
    expect(titles).toContain('Connect another node')
    // History and refreshing the folder are the panel's own now, not repeated in the menu.
    expect(titles).not.toContain('History')
    expect(titles).not.toContain('Refresh folder')
  })
})

describe('the place menu’s external-worktrees item', () => {
  const switchOf = (menu: Shown) =>
    menu.items.find((i) => i.title === 'Browse external workspaces')!
  const twoWays = (menu: Shown) =>
    menu.items.filter((i) => /^(Allow|Stop browsing) external/.test(i.title))

  it('is one switch, checked, when the node says browsing is on, and turns it off', async () => {
    f.request.mockResolvedValue({
      project_id: 'sample-project',
      external_read: true,
      default_branch: null,
    })
    const menu = await opened()
    expect(f.request).toHaveBeenCalledWith('project.repository_settings.get', {
      project_id: 'sample-project',
    })
    expect(switchOf(menu).checked).toBe(true)
    expect(twoWays(menu)).toHaveLength(0)
    switchOf(menu).handler!()
    await vi.waitFor(() =>
      expect(f.settings).toHaveBeenCalledWith({
        project_id: 'sample-project',
        external_read: false,
      })
    )
  })
  it('is one switch, unchecked, when browsing is off, and turns it on', async () => {
    f.request.mockResolvedValue({
      project_id: 'sample-project',
      external_read: false,
      default_branch: null,
    })
    const menu = await opened()
    expect(switchOf(menu).checked).toBeFalsy()
    expect(twoWays(menu)).toHaveLength(0)
    switchOf(menu).handler!()
    await vi.waitFor(() =>
      expect(f.settings).toHaveBeenCalledWith({
        project_id: 'sample-project',
        external_read: true,
      })
    )
  })
  it('offers both ways on a node that cannot say, and still switches browsing on', async () => {
    f.request.mockRejectedValue(new Error('unsupported_method'))
    const menu = await opened()
    expect(switchOf(menu)).toBeUndefined()
    allow(menu).handler!()
    await vi.waitFor(() =>
      expect(f.settings).toHaveBeenCalledWith({
        project_id: 'sample-project',
        external_read: true,
      })
    )
    expect(menu.items.some((i) => i.title === 'Stop browsing external workspaces')).toBe(true)
  })
})
