import { catalogs as testCatalogs } from '@/i18n/catalogs'
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { initializeLocale } from '@/i18n'
import { ref } from 'vue'
import {
  chooseNodePathChat,
  createNodePathObsidianActions,
  revokeNodePathChatApprovals,
} from '@/node/NodePathObsidianActions'
const f = vi.hoisted(() => ({
  picker: undefined as any,
  items: [] as any[],
  sessions: [] as any[],
  active: { value: '' },
  revoke: vi.fn(),
  switch: vi.fn(),
  reveal: vi.fn(async () => {}),
  node: {
    id: 'node:sample-registration:sample-session',
    label: { value: 'Remote chat' },
    reference: { registrationId: 'sample-registration' },
    draft: { value: { text: 'Existing draft' } },
    send: vi.fn(),
  },
}))
afterEach(() => {
  initializeLocale('en', testCatalogs['en' as keyof typeof testCatalogs])
  f.picker = undefined
})
vi.mock('@/components/nodeWork/NodeSuggestModal', () => ({
  NodeSuggestModal: class {
    constructor(
      _app: unknown,
      items: any[],
      _placeholder: string,
      readonly choose: (item: { id: string }) => void
    ) {
      f.picker = this
      f.items = items
    }
    open() {}
    onClose() {}
  },
}))
vi.mock('@/ai/ChatService', () => ({
  ChatService: {
    getInstance: () => ({
      getAllSessions: () => f.sessions,
      tabOrder: { value: [f.node.id] },
      activeTabId: f.active,
      getNodeSession: () => f.node,
      switchTab: f.switch,
      revealSidebar: f.reveal,
    }),
  },
}))
vi.mock('@/stores/GlobalStore', () => ({ GlobalStore: { getInstance: () => ({ app: {} }) } }))
vi.mock('@/ai/tools/node/owner', () => ({
  revokeObsidianNodeScopeApprovals: f.revoke,
  giveObsidianChatAccess: vi.fn(),
  nodeAgentHost: async () => ({
    nodes: () => [{ id: 'sample-registration', node_id: 'sample-node', label: 'Sample node' }],
    nodeId: (id: string) => (id === 'sample-registration' ? 'sample-node' : id),
    connection: () => ({ client: { connected: false } }),
  }),
}))

beforeEach(() => {
  f.picker = undefined
  f.active.value = ''
})
describe('node row scope integration', () => {
  it('adds selected code directly to the active node chat', async () => {
    f.active.value = f.node.id
    await createNodePathObsidianActions().add({
      target: {
        registrationId: 'sample-registration',
        nodeId: 'sample-node',
        projectId: 'sample-project',
        kind: 'worktree',
        id: 'sample-tree',
      },
      path: 'src/active.ts',
      selection: 'const active = true',
    })
    expect(f.picker).toBeUndefined()
    expect(f.node.draft.value.text).toContain('> const active = true')
    f.node.draft.value.text = 'Existing draft'
  })
  it('offers node chats when choosing a context destination', async () => {
    void chooseNodePathChat(undefined, true)
    await vi.waitFor(() => expect(f.items.some((i) => i.id === f.node.id)).toBe(true))
    f.picker.choose({ id: f.node.id })
  })
  it('appends readable selected code to the chosen node draft without sending', async () => {
    const adding = createNodePathObsidianActions().add({
      target: {
        registrationId: 'sample-registration',
        nodeId: 'sample-node',
        projectId: 'sample-project',
        kind: 'worktree',
        id: 'sample-tree',
      },
      path: 'src/sample.ts',
      selection: 'const sample = 1',
      lines: { start: 2, end: 4 },
      side: 'before',
    })
    await vi.waitFor(() => expect(f.picker).toBeDefined())
    f.picker.choose({ id: f.node.id })
    await adding
    expect(f.node.draft.value.text).toBe(
      'Existing draft\n\nsrc/sample.ts:2-4 (before)\n\n> const sample = 1'
    )
    expect(f.switch).toHaveBeenCalledWith(f.node.id)
    expect(f.node.send).not.toHaveBeenCalled()
  })
  it('translates chat picker kind tooltips while keeping its selected identity', async () => {
    initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
    const first = { id: 'sample-first', chatTitle: ref('Sample first') }
    const second = { id: 'sample-second', chatTitle: ref('Sample second') }
    f.sessions = [first, second]
    f.picker = undefined
    const pending = chooseNodePathChat((session) =>
      session.id === first.id ? 'sample-folder' : undefined
    )
    await vi.waitFor(() => expect(f.picker).toBeDefined())
    expect(f.items[0].kind).toBe('Уже есть доступ к sample-folder')
    expect(f.items[1].kind).toBe('Чат Obsidian')
    f.picker.choose({ id: second.id })
    expect(await pending).toBe(second)
  })
  it('retains the explicit chosen chat when the native prompt closes before delivering its choice', async () => {
    const session = { id: 'sample-chat', chatTitle: ref('Sample chat') }
    f.sessions = [session]
    const pending = chooseNodePathChat()
    await vi.waitFor(() => expect(f.picker).toBeDefined())
    f.picker.onClose()
    f.picker.choose({ id: session.id })
    expect(await pending).toBe(session)
  })
  it('uses the public scope revoker, not a prompt or a metadata-only removal', async () => {
    await revokeNodePathChatApprovals('sample-node')
    expect(f.revoke).toHaveBeenCalledWith('sample-node')
  })
  it('marks a chat that already reaches the place, its access kept under the node’s own id', async () => {
    const session = {
      id: 'sample-chat',
      chatTitle: ref('Sample chat'),
      overrides: ref({
        nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'edit' }],
      }),
    }
    f.sessions = [session]
    f.picker = undefined
    void createNodePathObsidianActions().grant({
      target: {
        registrationId: 'sample-registration',
        nodeId: 'sample-node',
        projectId: 'sample-project',
        kind: 'worktree',
        id: 'sample-tree',
      },
    } as never)
    await vi.waitFor(() => expect(f.picker).toBeDefined())
    expect(f.items[0].kind).toMatch(/^Already has access to /)
  })
  it('tells chats apart even when one has nothing asked yet, and marks access only by its tooltip glyph', async () => {
    const fresh = {
      id: 'sample-fresh',
      chatTitle: ref('Chat'),
      messages: ref([]),
      overrides: ref({}),
    }
    const used = {
      id: 'sample-used',
      chatTitle: ref('Chat'),
      messages: ref([
        { role: 'user', content: 'Sample question about the app', timestamp: Date.now() - 120000 },
      ]),
      overrides: ref({}),
    }
    f.sessions = [fresh, used]
    f.picker = undefined
    void chooseNodePathChat()
    await vi.waitFor(() => expect(f.picker).toBeDefined())
    const a = f.items.find((i: { id: string }) => i.id === 'sample-fresh')
    const b = f.items.find((i: { id: string }) => i.id === 'sample-used')
    expect(a.note).toContain('no questions yet')
    expect(b.note).toContain('2 min ago')
    expect(b.note).toContain('Sample question about the app')
    for (const item of f.items) {
      expect(item.icon).toBe('messages-square')
      expect(item.kind).toBe('Obsidian chat')
    }
  })
})
