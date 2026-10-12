import { afterEach, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import type { WorkspaceLeaf } from 'obsidian'
import { NodePathMainView } from '@/views/NodePathMainView'

const fixture = vi.hoisted(() => ({
  connect: vi.fn(),
  ready: vi.fn(),
  model: undefined as any,
  presenter: undefined as any,
}))
vi.mock('obsidian', async (original) => {
  const api = await original<typeof import('obsidian')>()
  return {
    ...api,
    ItemView: class extends api.ItemView {
      get contentEl() {
        return this.containerEl.children[1] as HTMLElement
      }
      addAction() {}
    },
  }
})
vi.mock('vue', async (original) => ({
  ...(await original<typeof import('vue')>()),
  createApp: () => ({ mount() {}, unmount() {} }),
}))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      nodes: { value: [{ id: 'sample-registration', expectedNodeId: 'sample-node' }] },
      connection: () => ({
        connect: fixture.connect,
        state: { value: 'connected' },
        client: { onEvent: () => () => {} },
      }),
    }),
  },
}))
vi.mock('@/node/NodePathService', () => ({
  NodePathService: {
    getInstance: () => ({
      model: () => {
        if (fixture.model instanceof Error) throw fixture.model
        return fixture.model
      },
      ready: fixture.ready,
    }),
  },
}))
vi.mock('@/node/NodePathController', () => ({
  showNodePathFileMenu: vi.fn(),
  chooseSessionWorktree: vi.fn(),
  newNodePathChat: vi.fn(),
}))
vi.mock('@/node/NodePathOwnerActions', () => ({
  nodePathOwnerActions: vi.fn(),
  freezeNodePathContext: vi.fn(),
}))
vi.mock('@/node/NodeChatPresenter', () => ({
  NodeChatPresenter: class {
    draft = { value: { text: '' } }
    constructor() {
      fixture.presenter = this
    }
    async load() {
      await fixture.connect()
      this.draft.value.text = 'Saved draft'
    }
    destroy() {}
  },
}))

const target = {
  nodeId: 'sample-node',
  registrationId: 'sample-registration',
  projectId: 'sample-project',
  kind: 'worktree',
  id: 'sample-worktree',
}
const views: NodePathMainView[] = []

it('appends quoted context after an asynchronously restored chat draft', async () => {
  let connected!: () => void
  fixture.connect.mockReturnValue(
    new Promise<void>((resolve) => {
      connected = resolve
    })
  )
  fixture.model = { sessions: shallowRef([]) }
  const view = new NodePathMainView({} as WorkspaceLeaf, 'abele-node-chat')
  views.push(view)
  view.app = { workspace: {} } as any
  await view.setState(
    { kind: 'chat', target, sessionId: 'sample-session', title: 'Sample chat' },
    {}
  )
  view.appendChatText('Quoted sample')
  connected()
  for (let i = 0; i < 20; i++) await Promise.resolve()
  expect(fixture.presenter.draft.value.text).toBe('Saved draft\n\nQuoted sample')
})
afterEach(async () => {
  for (const view of views.splice(0)) await view.onClose()
  vi.clearAllMocks()
})

it('shows binding failures instead of leaving an admitted tab blank', async () => {
  fixture.model = new Error('Sample node is unavailable')
  const view = new NodePathMainView({} as WorkspaceLeaf, 'abele-node-history')
  views.push(view)
  view.app = { workspace: {} } as any
  await view.setState({ kind: 'history', target }, {})
  for (let i = 0; i < 10; i++) await Promise.resolve()
  expect(view.containerEl.textContent).toContain('Sample node is unavailable')
})

it.each(['file', 'history', 'editor', 'chat'])(
  'restores a %s shell without waiting for a node connection',
  async (kind) => {
    fixture.connect.mockReturnValue(new Promise(() => {}))
    fixture.ready.mockReturnValue(new Promise(() => {}))
    fixture.model = {
      online: shallowRef(true),
      hasRetained: () => false,
      port: {},
      sessions: shallowRef([]),
      copy: () => undefined,
    }
    const view = new NodePathMainView({} as WorkspaceLeaf, `abele-node-${kind}`)
    views.push(view)
    view.app = { workspace: {} } as any
    let settled = false
    const state = {
      kind,
      target,
      ...(['file', 'editor'].includes(kind) ? { path: 'sample.ts' } : {}),
      ...(kind === 'chat' ? { sessionId: 'sample-session', title: 'Sample chat' } : {}),
    }
    void view.setState(state, {}).then(() => {
      settled = true
    })
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(settled).toBe(true)
  }
)

it.each(['file', 'history'])(
  'loads a %s independently of an unfinished catalogue/tree refresh',
  async (kind) => {
    fixture.connect.mockResolvedValue(undefined)
    fixture.ready.mockReturnValue(new Promise(() => {}))
    const file = vi.fn(async () => ({
      target,
      path: 'sample.ts',
      text: 'sample',
      contentId: 'sample-content',
    }))
    const history = vi.fn(async () => ({ entries: [], cursor: null }))
    fixture.model = {
      online: shallowRef(true),
      hasRetained: () => false,
      openFile: file,
      port: { history },
      copy: () => undefined,
    }
    const view = new NodePathMainView({} as WorkspaceLeaf, `abele-node-${kind}`)
    views.push(view)
    view.app = { workspace: { requestSaveLayout() {} } } as any
    void view.setState({ kind, target, ...(kind === 'file' ? { path: 'sample.ts' } : {}) }, {})
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(kind === 'file' ? file : history).toHaveBeenCalledTimes(1)
    expect(fixture.ready).not.toHaveBeenCalled()
  }
)
