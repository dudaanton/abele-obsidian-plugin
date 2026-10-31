/**
 * What the «Node workspaces» window did, as the node panel does it now: a new chat offers only
 * the providers the node reports, a new worktree reserves its job without starting a chat, a
 * folder's settings and removal sit in its place menu, destructive items come last and act on
 * the place that was confirmed, never on whatever the panel shows by then.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { Menu } from 'obsidian'
import {
  newNodePathChat,
  pickNodePathPlace,
  showNodePathPlaceMenu,
  removeNodePathFolder,
} from '@/node/NodePathController'
import { NodePathMutations } from '@/node/NodePathMutations'
import { nodePages } from '@/node/nodePages'
import { pathPages } from '@/node/NodePathClientPort'

const f = vi.hoisted(() => ({
  state: 'connected',
  items: [] as { id: string; title: string; kind?: string; note?: string }[],
  choose: (_item: { id: string }) => {},
  confirm: vi.fn(async () => true),
  client: {} as Record<string, ReturnType<typeof vi.fn>>,
}))
vi.mock('@/stores/GlobalStore', () => ({ GlobalStore: { getInstance: () => ({ app: {} }) } }))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      nodes: ref([]),
      connection: () => ({ state: ref(f.state), client: f.client }),
    }),
  },
}))
vi.mock('@/node/NodePathOwnerActions', () => ({
  nodePathOwnerActions: () => ({ ask: vi.fn(), add: vi.fn(), grant: vi.fn() }),
  freezeNodePathContext: (c: unknown) => c,
}))
vi.mock('@/components/obsidian/dialogs', () => ({ confirmDialog: f.confirm }))
vi.mock('@/components/nodeWork/NodeSuggestModal', () => ({
  NodeSuggestModal: class {
    constructor(
      _app: unknown,
      items: typeof f.items,
      _title: string,
      choose: (item: { id: string }) => void
    ) {
      f.items = items
      f.choose = choose
    }
    open() {}
  },
}))
afterEach(() => {
  f.state = 'connected'
  f.items = []
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const target = (id: string) => ({
  registrationId: 'sample-registration',
  nodeId: 'sample-node',
  projectId: 'sample-project',
  kind: 'worktree' as const,
  id,
})
function model(selected = 'sample-root') {
  const targets = [target('sample-root'), target('sample-feature')]
  return {
    registrationId: 'sample-registration',
    capabilities: ref(['node_path_v2', 'node_path_worktrees', 'node_path_execution']),
    folders: ref([
      {
        id: 'sample-project',
        name: 'sample-app',
        path: '/sample/app',
        git: true,
        copies: [
          { id: 'sample-root', kind: 'project', branch: 'trunk', path: '/sample/app' },
          { id: 'sample-feature', kind: 'worktree', branch: 'feature', path: '/sample/feature' },
        ],
      },
    ]),
    targets: ref(targets),
    target: (id: string) => targets.find((t) => t.id === id)!,
    selected: ref(selected),
    current: ref(targets.find((t) => t.id === selected)),
    currentFolder: ref({ id: 'sample-project', git: true }),
    port: { branch: vi.fn() },
    refresh: vi.fn(async () => {}),
    select: vi.fn(async () => {}),
    report: vi.fn(),
  }
}
type Shown = {
  items: {
    title: string
    checked: boolean | null
    warning?: boolean
    handler: (() => void) | null
  }[]
}
async function placeMenu(m: ReturnType<typeof model>): Promise<Shown> {
  const show = vi.spyOn(Menu.prototype, 'showAtPosition')
  showNodePathPlaceMenu(m as never, new MouseEvent('click'), () => {})
  await vi.waitFor(() => expect(show).toHaveBeenCalled())
  return show.mock.instances[0] as unknown as Shown
}
function client(over: Record<string, unknown> = {}) {
  f.client = {
    request: vi.fn(async () => ({ project_id: 'sample-project', external_read: false })),
    getProject: vi.fn(async () => ({ use_repository_claude_permissions: false })),
    setProjectClaudePermissions: vi.fn(async () => ({})),
    removeProject: vi.fn(async () => ({})),
    describe: vi.fn(async () => ({
      providers: [
        { provider: 'claude', available: true },
        { provider: 'pi', available: false, diagnostic: 'Not installed' },
      ],
    })),
    ...over,
  } as never
}

describe('the node panel instead of the workspaces window', () => {
  it('unregisters an unavailable folder through the existing project API without filesystem actions', async () => {
    client()
    const m = model()
    const folder = {
      id: 'sample-project',
      name: 'Sample',
      path: '/sample/removed',
      git: true,
      missing: true,
      copies: [],
    }
    await removeNodePathFolder(m as never, folder)
    expect(f.client.removeProject).toHaveBeenCalledExactlyOnceWith(folder.id)
    expect(m.refresh).toHaveBeenCalledOnce()
    expect(f.confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('stays on disk'),
      })
    )
  })
  it('reads bounded pages until empty, never mistakes a short page for the end', async () => {
    const read = vi.fn(async (after?: string) => (after ? [] : [{ id: 'p' }]))
    expect(await nodePages(read, (p) => p.id)).toHaveLength(1)
    expect(read.mock.calls).toEqual([[undefined], ['p']])
  })

  it('pages a worktree’s status until the node says there is no more', async () => {
    const read = vi.fn(async (cursor?: string) => ({
      entries: [cursor ? 'second.txt' : 'first.txt'],
      cursor: cursor ? null : 'next',
      incomplete: false,
      omissions: [],
    }))
    expect(await pathPages(read)).toEqual(['first.txt', 'second.txt'])
  })

  it('offers a new chat every agent, those the node cannot start now unavailable with why', async () => {
    client()
    await newNodePathChat(model() as never, target('sample-root'))
    expect(f.items.map((i) => i.title)).toEqual(['Claude Code', 'Codex', 'pi'])
    const disabled = f.items.map((i) => (i as { disabled?: string }).disabled)
    expect(disabled[0]).toBeUndefined()
    expect(disabled.slice(1).every(Boolean)).toBe(true)
  })

  it('reserves a new worktree’s job without attaching a chat to it', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'workspace.create' ? { workspace_id: 'w', job_id: 'j' } : {}
    )
    const mutations = new NodePathMutations({
      store: { transaction: async (run: (raw: object) => unknown) => run({}) },
      nodePath: {
        createWorkspace: (params: unknown, id: string) => request('workspace.create', params, id),
      },
    } as never)
    expect(await mutations.create('sample-project', 'feature', 'HEAD')).toEqual({
      workspace_id: 'w',
      job_id: 'j',
    })
    expect(request.mock.calls.map((c) => c[0])).toEqual(['workspace.create'])
  })

  it('switches the folder to the repository’s Claude permissions from its menu', async () => {
    client()
    const menu = await placeMenu(model())
    const item = menu.items.find((i) => i.title === 'Use the repository’s Claude permissions')!
    expect(item.checked).toBeFalsy()
    item.handler!()
    await vi.waitFor(() =>
      expect(f.client.setProjectClaudePermissions).toHaveBeenCalledWith('sample-project', true)
    )
  })

  it('puts what cannot be undone last of the place’s items, in the warning colour', async () => {
    client()
    const menu = await placeMenu(model('sample-feature'))
    const titles = menu.items.map((i) => i.title)
    const end = titles.indexOf('Open a folder…')
    expect(titles.slice(end - 2, end)).toEqual(['Remove from the list', 'Delete the worktree…'])
    expect(menu.items.slice(end - 2, end).every((i) => i.warning)).toBe(true)
    // The folder itself is removed from its root's menu, not from a worktree's.
    expect(titles).not.toContain('Remove the folder from the node…')
  })

  it('never offers to delete the folder’s own checkout as a worktree', async () => {
    client()
    const titles = (await placeMenu(model())).items.map((i) => i.title)
    expect(titles).not.toContain('Delete the worktree…')
    expect(titles[titles.indexOf('Open a folder…') - 1]).toBe('Remove the folder from the node…')
  })

  it('removes the folder that was confirmed even when the panel moved on meanwhile', async () => {
    client()
    const m = model()
    const menu = await placeMenu(m)
    f.confirm.mockImplementationOnce(async () => {
      m.selected.value = 'elsewhere'
      m.currentFolder.value = { id: 'other-project', git: true }
      return true
    })
    menu.items.find((i) => i.title === 'Remove the folder from the node…')!.handler!()
    await vi.waitFor(() => expect(f.client.removeProject).toHaveBeenCalledWith('sample-project'))
  })

  it('removes nothing when the question is declined', async () => {
    client()
    const menu = await placeMenu(model())
    f.confirm.mockResolvedValueOnce(false)
    menu.items.find((i) => i.title === 'Remove the folder from the node…')!.handler!()
    await vi.waitFor(() => expect(f.confirm).toHaveBeenCalled())
    expect(f.client.removeProject).not.toHaveBeenCalled()
  })

  it('deletes the worktree that was confirmed even when the panel moved on meanwhile', async () => {
    const deleteWorktree = vi.fn(async () => ({ worktree_id: 'sample-feature', state: 'deleted' }))
    client({
      repository: {
        worktrees: vi.fn(async () => ({
          entries: [
            {
              worktree_id: 'sample-root',
              kind: 'root',
              path_label: '/sample/app',
              head: 'a'.repeat(40),
            },
            {
              worktree_id: 'sample-feature',
              kind: 'external',
              path_label: '/sample/feature',
              head: 'b'.repeat(40),
            },
          ],
          cursor: null,
          incomplete: false,
          omissions: [],
        })),
        observe: vi.fn(async () => ({ revision: { kind: 'working', observation_id: 'seen' } })),
      },
      nodePath: { deleteWorktree },
      store: { transaction: async (run: (raw: object) => unknown) => run({}) },
    })
    const m = model('sample-feature')
    const menu = await placeMenu(m)
    f.confirm.mockImplementationOnce(async () => {
      m.selected.value = 'sample-root'
      m.current.value = target('sample-root')
      return true
    })
    menu.items.find((i) => i.title === 'Delete the worktree…')!.handler!()
    await vi.waitFor(() => expect(deleteWorktree).toHaveBeenCalled())
    expect(deleteWorktree.mock.calls[0][0]).toMatchObject({
      worktree_id: 'sample-feature',
      expected_head: 'b'.repeat(40),
      expected_observation_id: 'seen',
    })
  })

  it('refreshes the catalogue before showing worktrees created outside the panel', async () => {
    const m = model()
    m.folders.value[0].copies = [m.folders.value[0].copies[0]]
    f.items = []
    m.refresh.mockImplementation(async () => {
      m.folders.value[0].copies.push({
        id: 'sample-created',
        kind: 'worktree',
        branch: 'new-topic',
        path: '/sample/new-topic',
      })
    })
    pickNodePathPlace(m as never, vi.fn())
    await vi.waitFor(() => expect(f.items.some((item) => item.id === 'sample-created')).toBe(true))
    expect(m.refresh).toHaveBeenCalledOnce()
  })

  it('lists every folder, each worktree of a repository and the chats that work in it', async () => {
    const m = model()
    m.folders.value = [
      {
        ...m.folders.value[0],
        copies: [
          m.folders.value[0].copies[0],
          { ...m.folders.value[0].copies[1], chats: [{ id: 'chat-1', title: 'Sample chat' }] },
        ],
      } as never,
      { id: 'notes', name: 'sample-notes', path: '/sample/notes', git: false, copies: [] } as never,
    ]
    const openChat = vi.fn()
    pickNodePathPlace(m as never, openChat)
    await vi.waitFor(() => expect(m.refresh).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(f.items.some((item) => item.id === 'chat:chat-1')).toBe(true))
    expect(f.items.map((i) => [i.kind, i.title])).toEqual([
      ['The folder itself', 'sample-app / trunk'],
      ['Worktree', 'sample-app / feature'],
      ['Chat', 'Sample chat'],
      ['Folder', 'sample-notes'],
    ])
    f.choose({ id: 'chat:chat-1' })
    expect(openChat).toHaveBeenCalledWith('chat-1')
    f.choose({ id: 'sample-feature' })
    await vi.waitFor(() => expect(m.select).toHaveBeenCalledWith('sample-feature'))
  })

  it('deletes nothing and asks nothing when the node no longer lists the worktree', async () => {
    const deleteWorktree = vi.fn()
    client({
      repository: {
        worktrees: vi.fn(async () => ({
          entries: [
            {
              worktree_id: 'sample-root',
              kind: 'root',
              path_label: '/sample/app',
              head: 'a'.repeat(40),
            },
          ],
          cursor: null,
          incomplete: false,
          omissions: [],
        })),
        observe: vi.fn(),
      },
      nodePath: { deleteWorktree },
    })
    const m = model('sample-feature')
    const menu = await placeMenu(m)
    menu.items.find((i) => i.title === 'Delete the worktree…')!.handler!()
    await vi.waitFor(() => expect(f.client.repository.worktrees as never).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(f.confirm).not.toHaveBeenCalled()
    expect(deleteWorktree).not.toHaveBeenCalled()
  })
})

it('opens the cached switcher without refreshing an offline node', async () => {
  f.state = 'offline'
  const m = model()
  pickNodePathPlace(m as never, vi.fn())
  await vi.waitFor(() => expect(f.items.some((item) => item.id === 'sample-root')).toBe(true))
  expect(m.refresh).not.toHaveBeenCalled()
})
it('keeps cached switcher choices available when catalogue refresh fails', async () => {
  const m = model()
  m.refresh.mockRejectedValueOnce(new Error('sample connection lost'))
  pickNodePathPlace(m as never, vi.fn())
  await vi.waitFor(() => expect(f.items.some((item) => item.id === 'sample-root')).toBe(true))
  expect(m.refresh).toHaveBeenCalledOnce()
})
