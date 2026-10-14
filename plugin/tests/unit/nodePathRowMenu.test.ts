import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { Menu } from 'obsidian'
import { showNodePathRowMenu } from '@/node/NodePathController'

const f = vi.hoisted(() => ({
  request: vi.fn<(method: string, params: unknown) => Promise<unknown>>(),
  settings: vi.fn(async () => ({})),
  refresh: vi.fn(async () => {}),
}))
vi.mock('@/stores/GlobalStore', () => ({ GlobalStore: { getInstance: () => ({ app: {} }) } }))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      connection: () => ({
        state: ref('connected'),
        client: { request: f.request, setRepositorySettings: f.settings },
      }),
    }),
  },
}))
vi.mock('@/node/NodePathOwnerActions', () => ({
  nodePathOwnerActions: () => ({ ask: vi.fn(), add: vi.fn(), grant: vi.fn() }),
  freezeNodePathContext: (c: unknown) => c,
}))
vi.mock('@/modal/confirm', () => ({ confirmAction: async () => true }))
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
    refresh: f.refresh,
  } as never
}
type Shown = { items: { title: string; checked: boolean | null; handler: (() => void) | null }[] }
async function opened(): Promise<Shown> {
  const show = vi.spyOn(Menu.prototype, 'showAtPosition')
  showNodePathRowMenu(model(), new MouseEvent('contextmenu'), 'sample-project')
  await vi.waitFor(() => expect(show).toHaveBeenCalled())
  return show.mock.instances[0] as unknown as Shown
}
const allow = (menu: Shown) =>
  menu.items.find((i) => i.title === 'Allow external workspace browsing')!

describe('the folder menu’s external-worktrees item', () => {
  it('is checked when the node says browsing is on', async () => {
    f.request.mockResolvedValue({
      project_id: 'sample-project',
      external_read: true,
      default_branch: null,
    })
    const menu = await opened()
    expect(f.request).toHaveBeenCalledWith('project.repository_settings.get', {
      project_id: 'sample-project',
    })
    expect(allow(menu).checked).toBe(true)
  })
  it('is unchecked when browsing is off', async () => {
    f.request.mockResolvedValue({
      project_id: 'sample-project',
      external_read: false,
      default_branch: null,
    })
    expect(allow(await opened()).checked).toBeFalsy()
  })
  it('is unchecked on a node that cannot say, and still switches browsing on', async () => {
    f.request.mockRejectedValue(new Error('unsupported_method'))
    const menu = await opened()
    expect(allow(menu).checked).toBeFalsy()
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
