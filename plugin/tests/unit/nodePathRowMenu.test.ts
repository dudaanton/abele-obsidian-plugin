import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { Menu } from 'obsidian'
import {
  showNodePathFileMenu,
  showNodePathNodeMenu,
  showNodePathPlaceMenu,
} from '@/node/NodePathController'

const f = vi.hoisted(() => ({
  methods: [] as string[],
  online: true,
  network: false,
  setNetwork: vi.fn(async (_project: string, enabled: boolean) => ({
    root_path: '/sample/project',
    codex_network_enabled: enabled,
  })),
  request: vi.fn<(method: string, params: unknown) => Promise<unknown>>(),
  settings: vi.fn(async () => ({})),
  refresh: vi.fn(async () => {}),
  describe: vi.fn(async (): Promise<unknown> => ({ capabilities: { capabilities: {} } })),
  remove: vi.fn(),
}))
vi.mock('@/stores/GlobalStore', () => ({ GlobalStore: { getInstance: () => ({ app: {} }) } }))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      nodes: ref([
        {
          id: 'sample-registration',
          expectedNodeId: 'sample-node',
          label: 'Sample node',
          url: 'ws://127.0.0.1:7777/channel',
        },
      ]),
      remove: f.remove,
      connection: () => ({
        state: ref(f.online ? 'connected' : 'offline'),
        client: {
          channel: {
            channel: {
              welcome: {
                get methods() {
                  return f.methods
                },
              },
            },
          },
          describe: f.describe,
          request: f.request,
          setRepositorySettings: f.settings,
          setProjectCodexPermissions: f.setNetwork,
          getProject: async () => ({
            root_path: '/sample/project',
            codex_network_enabled: f.network,
            use_repository_claude_permissions: false,
          }),
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
  f.methods = []
  f.online = true
  f.network = false
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

it('offers the project Codex network switch after New chat here on capable nodes', async () => {
  f.methods = ['project.codex_permissions']
  const menu = await opened()
  const names = menu.items.map((item) => item.title)
  expect(names[names.indexOf('New chat here') + 1]).toBe('Network for Codex')
  expect(menu.items.find((item) => item.title === 'Network for Codex')?.checked).toBe(false)
})

it('checks the persisted project choice and turns it off without a dialog', async () => {
  f.methods = ['project.codex_permissions']
  f.network = true
  const menu = await opened()
  const item = menu.items.find((item) => item.title === 'Network for Codex')!
  expect(item.checked).toBe(true)
  item.handler!()
  await vi.waitFor(() => expect(f.setNetwork).toHaveBeenCalledWith('sample-project', false))
})

it('disables the project switch offline and omits it on old nodes', async () => {
  f.methods = ['project.codex_permissions']
  f.online = false
  const menu = await opened()
  expect(
    (
      menu.items.find(
        (item) => item.title === 'Network for Codex — Reconnect to the node'
      ) as unknown as {
        disabled: boolean
      }
    ).disabled
  ).toBe(true)
  vi.restoreAllMocks()
  f.methods = []
  expect((await opened()).items.some((item) => item.title === 'Network for Codex')).toBe(false)
})

it('routes node-header Disconnect through the selected registration client', async () => {
  const description = {
    capabilities: { capabilities: { device_disconnect: { status: 'supported' } } },
  }
  f.describe.mockResolvedValueOnce(description).mockResolvedValueOnce(description)
  f.request.mockResolvedValueOnce({ disconnected: true })
  const show = vi.spyOn(Menu.prototype, 'showAtPosition')
  showNodePathNodeMenu(model(), new MouseEvent('click'))
  await vi.waitFor(() => expect(show).toHaveBeenCalled())
  const menu = show.mock.instances[0] as unknown as Shown
  menu.items.find((i) => i.title === 'Disconnect this device…')!.handler!()
  await vi.waitFor(() => expect(f.request).toHaveBeenCalledWith('node.disconnect', {}))
  expect(f.remove).toHaveBeenCalledWith('sample-registration')
})

it('offers folder rename, move and delete when the node advertises directory manifests', async () => {
  f.methods = [
    'repository.v1.file.directory',
    'repository.v1.file.move',
    'repository.v1.file.remove',
  ]
  const show = vi.spyOn(Menu.prototype, 'showAtPosition')
  showNodePathFileMenu(new MouseEvent('contextmenu'), {
    target,
    path: 'sample-folder',
    directory: true,
  })
  await vi.waitFor(() => expect(show).toHaveBeenCalled())
  const menu = show.mock.instances[0] as unknown as Shown
  expect(menu.items.map((item) => item.title)).toEqual(
    expect.arrayContaining(['Rename…', 'Move…', 'Delete…'])
  )
})

it('keeps file mutations available on older nodes without offering unsafe folder actions', async () => {
  f.methods = ['repository.v1.file.move', 'repository.v1.file.remove']
  const show = vi.spyOn(Menu.prototype, 'showAtPosition')
  showNodePathFileMenu(new MouseEvent('contextmenu'), {
    target,
    path: 'sample-folder',
    directory: true,
  })
  await vi.waitFor(() => expect(show).toHaveBeenCalled())
  expect((show.mock.instances[0] as unknown as Shown).items.map((item) => item.title)).not.toEqual(
    expect.arrayContaining(['Rename…', 'Move…', 'Delete…'])
  )
})

it('offers debugger actions in the node header menu', async () => {
  f.describe.mockResolvedValueOnce({
    capabilities: { capabilities: { debugger_v1: { status: 'supported', evidence: 'sample' } } },
  })
  f.request.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'js-ts-native' }])
  const show = vi.spyOn(Menu.prototype, 'showAtPosition')
  showNodePathNodeMenu(model(), new MouseEvent('click'))
  await vi.waitFor(() => expect(show).toHaveBeenCalled())
  const menu = show.mock.instances[0] as unknown as Shown
  await vi.waitFor(() => {
    expect(menu.items.map((item) => item.title)).toContain('Run a program')
    expect(menu.items.map((item) => item.title)).toContain('Attach to a running program')
  })
})

it.each(['node', 'place', 'file'] as const)(
  'freezes settled debugger readiness at the actual %s menu display boundary',
  async (kind) => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    f.describe.mockImplementationOnce(async () => {
      await pending
      return {
        capabilities: {
          capabilities: { debugger_v1: { status: 'supported', evidence: 'sample' } },
        },
      }
    })
    f.request.mockImplementation(async (method) => {
      if (method === 'debugger.v1.profiles') return [{ id: 'js-ts-native' }]
      if (method === 'debugger.v1.sessions') return []
      return { project_id: 'sample-project', external_read: false }
    })
    let snapshot: { title: string; disabled: boolean }[] | undefined
    vi.spyOn(Menu.prototype, 'showAtPosition').mockImplementation(function (this: Menu) {
      snapshot = (this as unknown as { items: { title: string; disabled: boolean }[] }).items.map(
        ({ title, disabled }) => ({ title, disabled })
      )
      return this
    })
    const event = new MouseEvent('contextmenu')
    if (kind === 'node') showNodePathNodeMenu(model(), event)
    else if (kind === 'place') showNodePathPlaceMenu(model(), event, () => {})
    else showNodePathFileMenu(event, { target, path: 'sample.js' })
    await vi.waitFor(() => expect(f.describe).toHaveBeenCalled())
    expect(snapshot).toBeUndefined()
    release()
    await vi.waitFor(() => expect(snapshot).toBeDefined())
    for (const title of ['Debug', 'Run a program', 'Attach to a running program'])
      expect(snapshot).toContainEqual({ title, disabled: false })
    expect(snapshot!.some((item) => /Checking/.test(item.title))).toBe(false)
    if (kind === 'place') {
      const titles = snapshot!.map((item) => item.title)
      expect(titles.indexOf('Debug')).toBeLessThan(titles.indexOf('New worktree'))
    }
  }
)

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

describe('where the place menu opens', () => {
  const button = () => {
    const el = document.createElement('div')
    el.getBoundingClientRect = () =>
      ({
        left: 290,
        right: 314,
        top: 100,
        bottom: 124,
        width: 24,
        height: 24,
        x: 290,
        y: 100,
      }) as DOMRect
    document.body.appendChild(el)
    return el
  }
  const shownAt = async (event: MouseEvent) => {
    const show = vi.spyOn(Menu.prototype, 'showAtPosition')
    showNodePathPlaceMenu(model(), event, () => {})
    await vi.waitFor(() => expect(show).toHaveBeenCalled())
    return show.mock.calls[0]![0]
  }
  it('opens at the pointer for a press with the mouse', async () => {
    f.request.mockResolvedValue({ project_id: 'sample-project', external_read: false })
    const el = button(),
      event = new MouseEvent('click', { clientX: 300, clientY: 110, detail: 1 })
    Object.defineProperty(event, 'currentTarget', { value: el })
    expect(await shownAt(event)).toEqual({ x: 300, y: 110 })
    el.remove()
  })
  it('opens under its button for a press from the keyboard, not in the window corner', async () => {
    f.request.mockResolvedValue({ project_id: 'sample-project', external_read: false })
    const el = button(),
      event = new MouseEvent('click', { clientX: 0, clientY: 0, detail: 0 })
    Object.defineProperty(event, 'currentTarget', { value: el })
    expect(await shownAt(event)).toEqual({ x: 290, y: 124 })
    el.remove()
  })
})
