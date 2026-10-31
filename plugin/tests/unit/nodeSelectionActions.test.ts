import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { chooseNodePathBase, newNodePathChat, pickNodePathPlace } from '@/node/NodePathController'
import { selectionQuote } from '@/components/nodeWork/fileSelection'

const f = vi.hoisted(() => ({
  choose: undefined as undefined | ((item: { id: string }) => void),
  items: [] as { id: string; title: string; note?: string; kind: string }[],
  append: vi.fn(),
  open: vi.fn(),
  refresh: vi.fn(async () => {}),
  execution: vi.fn(),
  session: vi.fn(),
  project: vi.fn(async () => ({ trust: 'trusted' })),
  confirm: vi.fn(async () => true),
}))
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: {
    getInstance: () => ({
      app: {
        workspace: {
          getLeavesOfType: () => [
            {
              getViewState: () => ({ state: { sessionId: 'sample-session' } }),
              view: { appendChatText: f.append },
            },
          ],
        },
      },
    }),
  },
}))
vi.mock('@/node/nodePathNavigation', () => ({ openNodePathTab: f.open, openNodeChat: f.open }))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      nodes: ref([]),
      connection: () => ({
        state: ref('connected'),
        client: {
          getProject: f.project,
          describe: async () => ({ providers: [{ provider: 'fake', available: true }] }),
        },
      }),
    }),
  },
}))
vi.mock('@/components/nodeWork/NodeSuggestModal', () => ({
  NodeSuggestModal: class {
    constructor(_app: unknown, items: typeof f.items, _text: string, choose: typeof f.choose) {
      f.items = items
      f.choose = choose
    }
    open() {}
  },
}))
vi.mock('@/components/obsidian/dialogs', () => ({ confirmDialog: f.confirm }))
vi.mock('@/node/NodePathMutations', () => ({
  NodePathMutations: class {
    trust = vi.fn()
    execution = f.execution
    session = f.session
  },
}))
beforeEach(() => vi.stubGlobal('__ABELE_TEST_SHARING__', true))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  f.choose = undefined
  f.items = []
})
const target = {
  registrationId: 'sample-registration',
  nodeId: 'sample-node',
  projectId: 'sample-project',
  kind: 'worktree' as const,
  id: 'sample-tree',
}
function model() {
  return {
    registrationId: target.registrationId,
    nodeId: target.nodeId,
    capabilities: ref(['node_path_execution']),
    current: ref(target),
    selected: ref('sample-tree'),
    select: vi.fn(async () => {}),
    folders: ref([
      {
        id: 'sample-project',
        name: 'sample-app',
        path: '/sample/app',
        git: true,
        copies: [
          {
            id: 'sample-tree',
            kind: 'project',
            branch: 'trunk',
            path: '/sample/app',
            changed: 2,
            chats: [{ id: 'sample-session', title: 'Sample chat', when: 'Today' }],
          },
        ],
      },
    ]),
    copy: () => undefined,
    refresh: f.refresh,
    report: vi.fn(),
    selectedChat: ref(''),
    error: ref(''),
    sessions: ref([{ session: { session_id: 'sample-session', title: 'Sample chat' }, target }]),
  } as never
}

describe('selected node file context', () => {
  it('asks in plain words before trusting a new folder and respects cancellation', async () => {
    f.project.mockResolvedValueOnce({ trust: 'untrusted' })
    f.confirm.mockResolvedValueOnce(false)
    await newNodePathChat(model(), target, 'Sample code')
    f.choose!({ id: 'fake' })
    await vi.waitFor(() =>
      expect(f.confirm).toHaveBeenCalledWith({
        title: 'Trust this folder for agents?',
        message: expect.stringContaining('/sample/app'),
        confirmText: 'Trust folder',
      })
    )
    expect(f.session).not.toHaveBeenCalled()
    expect(f.open).not.toHaveBeenCalled()
  })
  it('creates a target-bound node chat and seeds its draft, never sends a provider turn', async () => {
    f.session.mockResolvedValue({ session_id: 'sample-session', title: 'New chat' })
    const quote = selectionQuote('src/sample.ts', {
      text: '  const sample = 1',
      from: 4,
      to: 5,
      side: 'before',
    })
    expect(quote).toBe('src/sample.ts:4-5 (before)\n\n>   const sample = 1')
    await newNodePathChat(model(), target, quote)
    expect(f.append).not.toHaveBeenCalled()
    f.choose!({ id: 'fake' })
    // The chat opens in the sidebar with the quote in its draft, never sent.
    await vi.waitFor(() =>
      expect(f.open).toHaveBeenCalledWith(
        expect.anything(),
        { kind: 'chat', target, sessionId: 'sample-session', title: 'New chat' },
        false,
        quote
      )
    )
    expect(f.session).toHaveBeenCalledWith(target, 'New chat', 'fake')
    expect(f.confirm).not.toHaveBeenCalled()
  })
  it('finds a chat in the place search under its branch and opens it, offering nothing it cannot do', async () => {
    const opened = vi.fn()
    pickNodePathPlace(model(), opened)
    await vi.waitFor(() => expect(f.choose).toBeTypeOf('function'))
    const chat = f.items.find((i) => i.kind === 'Chat')!
    expect(chat).toMatchObject({ title: 'Sample chat', note: 'sample-app / trunk · Today' })
    // Only places and chats are listed: no rows standing for unsupported chat actions.
    expect(f.items.map((i) => i.kind)).toEqual(['The folder itself', 'Chat'])
    f.choose!(chat)
    expect(opened).toHaveBeenCalledWith('sample-session')
  })
  it('marks a worktree gone from disk by its glyph and words', async () => {
    const m = model() as unknown as { folders: { value: { copies: { missing?: boolean }[] }[] } }
    m.folders.value[0].copies[0].missing = true
    pickNodePathPlace(m as never, vi.fn())
    await vi.waitFor(() => expect(f.choose).toBeTypeOf('function'))
    expect(f.items[0]).toMatchObject({ icon: 'folder-x', kind: 'Not found on the node' })
  })
  it('lists each worktree with its changed files and shows the chosen one in the panel', async () => {
    const m = model() as unknown as { select: ReturnType<typeof vi.fn> }
    pickNodePathPlace(m as never, vi.fn())
    await vi.waitFor(() => expect(f.choose).toBeTypeOf('function'))
    const place = f.items[0] as (typeof f.items)[number] & { count?: { value: number } }
    expect(place).toMatchObject({ title: 'sample-app / trunk', count: { value: 2 } })
    f.choose!(place)
    await vi.waitFor(() => expect(m.select).toHaveBeenCalledWith('sample-tree'))
  })
  it.fails(
    'BUG: chat rename and delete require session mutations not yet exposed by the node protocol',
    async () => {
      pickNodePathPlace(model(), vi.fn())
      await vi.waitFor(() => expect(f.choose).toBeTypeOf('function'))
      expect(
        ['Rename', 'Delete'].every((word) => f.items.some((item) => item.title.startsWith(word)))
      ).toBe(true)
    }
  )
})

describe('compare with', () => {
  it('offers the branches, remote branches and tags by name and counts against the one chosen', async () => {
    const m = {
      panelBase: ref(''),
      panelMode: ref('files'),
      panelBranch: ref({
        state: {
          base: 'origin/trunk',
          baseRef: 'refs/remotes/origin/trunk',
          ahead: 1,
          behind: 0,
          unpushed: 0,
        },
        committed: [],
        refs: ['refs/heads/other', 'refs/remotes/origin/trunk', 'refs/tags/v1'],
      }),
      loadPanelBranch: vi.fn(async () => {}),
    }
    chooseNodePathBase(m as never)
    await vi.waitFor(() => expect(f.items).toHaveLength(3))
    expect(f.items.map((i) => [i.title, i.kind])).toEqual([
      ['other', 'Branch'],
      ['origin/trunk', 'Remote branch'],
      ['v1', 'Tag'],
    ])
    expect((f.items[1] as { current?: boolean }).current).toBe(true)
    f.choose!(f.items[0])
    expect(m.panelBase.value).toBe('refs/heads/other')
    expect(m.panelMode.value).toBe('changes')
  })
})
