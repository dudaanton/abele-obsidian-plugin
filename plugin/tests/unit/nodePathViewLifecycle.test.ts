import { afterEach, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { Platform, type WorkspaceLeaf } from 'obsidian'
import { NodePathMainView } from '@/views/NodePathMainView'
import { FILE_NAVIGATION } from '@/node/fileNavigation'
import { nodeRepositoryLink } from '@/repository/nodeLinks'

it('reports retained local edits to file tree actions', () => {
  const view = Object.create(NodePathMainView.prototype) as NodePathMainView
  const dirty = shallowRef(true)
  Object.assign(view, { editing: { dirty } })
  expect(view.hasUnsentNodeFileEdit()).toBe(true)
  dirty.value = false
  expect(view.hasUnsentNodeFileEdit()).toBe(false)
})

const fixture = vi.hoisted(() => ({
  connect: vi.fn(),
  ready: vi.fn(),
  model: undefined as any,
  presenter: undefined as any,
  openChat: vi.fn(async () => {}),
  openFile: vi.fn(async () => {}),
  installation: 'sample-installation' as string | undefined,
  root: undefined as any,
}))
vi.mock('@/node/nodePathNavigation', async (original) => ({
  ...(await original<typeof import('@/node/nodePathNavigation')>()),
  openNodeChat: fixture.openChat,
  openNodeFileDestination: fixture.openFile,
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
      onPaneMenu() {}
    },
  }
})
vi.mock('vue', async (original) => ({
  ...(await original<typeof import('vue')>()),
  createApp: (root: unknown) => {
    fixture.root = root
    return { mount() {}, unmount() {} }
  },
}))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      nodes: { value: [{ id: 'sample-registration', expectedNodeId: 'sample-node' }] },
      connection: () => ({
        connect: fixture.connect,
        state: { value: 'connected' },
        client: {
          onEvent: () => () => {},
          store: {
            transaction: async (read: (state: unknown) => unknown) =>
              read({ installation_id: fixture.installation }),
          },
        },
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

it('provides target-bound navigation and the destination line to the edited-file surface', async () => {
  fixture.connect.mockResolvedValue(undefined)
  fixture.ready.mockResolvedValue(undefined)
  fixture.model = {
    online: shallowRef(true),
    hasRetained: () => false,
    openFile: vi.fn(async () => ({
      target,
      path: 'sample.ts',
      text: 'first\nsecond\n',
      contentId: 'sample-content',
      revision: { kind: 'commit', commit: 'a'.repeat(40) },
    })),
  }
  const view = new NodePathMainView({} as WorkspaceLeaf, 'abele-node-file')
  views.push(view)
  view.app = { workspace: { requestSaveLayout() {} } } as any
  await view.setState({ kind: 'file', target, path: 'sample.ts', line: 2 }, {})
  await vi.waitFor(() => expect((view as any).file?.document.value).toBeDefined())
  fixture.root.render().props.onNavigate({ kind: 'file', target, path: 'sample.ts', line: 2 })
  await vi.waitFor(() =>
    expect(fixture.openFile).toHaveBeenCalledWith(
      view.app.workspace,
      { kind: 'file', target, path: 'sample.ts', line: 2 },
      expect.any(Boolean)
    )
  )
  fixture.openFile.mockClear()
  const navigate = fixture.root.provide?.[FILE_NAVIGATION as symbol]
  expect(navigate).toBeTypeOf('function')
  const comparisonLink = nodeRepositoryLink(
    {
      provider: 'node',
      installation: 'sample-installation',
      node: target.registrationId,
      project: target.projectId,
      workspace: target.id,
    },
    { kind: 'file', ref: 'a'.repeat(40), path: 'sample.ts', lines: { from: 2, to: 2 } }
  )
  expect(navigate(comparisonLink)).toBe(false)
  expect(
    navigate(
      nodeRepositoryLink(
        {
          provider: 'node',
          installation: 'sample-installation',
          node: target.registrationId,
          project: target.projectId,
          workspace: target.id,
        },
        { kind: 'file', ref: 'working-sample', path: 'sample.ts', lines: { from: 2, to: 2 } }
      )
    )
  ).toBe(true)
  await vi.waitFor(() =>
    expect(fixture.openFile).toHaveBeenCalledWith(
      view.app.workspace,
      { kind: 'file', target, path: 'sample.ts', line: 2 },
      expect.any(Boolean)
    )
  )
  ;(view as any).editing.editor.value = { draftDirty: shallowRef(false) }
  ;(view as any).editing.active.value = true
  expect(fixture.root.render().props.line).toBe(2)
  expect(navigate(comparisonLink)).toBe(true)
  await vi.waitFor(() => expect(fixture.openFile).toHaveBeenCalledTimes(2))
})

it('reveals a cited range in the whole file even when the existing tab shows a diff', async () => {
  const view = new NodePathMainView({} as WorkspaceLeaf, 'abele-node-file')
  views.push(view)
  view.app = { workspace: {} } as any
  const state = { kind: 'file', target, path: 'sample.ts' }
  ;(view as any).saved = state
  ;(view as any).ui = { unmount: vi.fn() }
  const file = {
    mode: shallowRef('diff'),
    markdownMode: shallowRef<'code' | 'preview'>(),
    destroy: vi.fn(),
  }
  ;(view as any).file = file
  const active = shallowRef(true)
  const stop = vi.fn(() => {
    active.value = false
  })
  ;(view as any).editing = { active, stop, destroy: vi.fn() }
  await view.setState({ ...state, line: 3, endLine: 7 }, {})
  expect(stop).toHaveBeenCalledOnce()
  expect(file.mode.value).toBe('file')
  expect((view as any).navigationEndLine.value).toBe(7)
  await view.setState({ ...state, line: 3, endLine: 9, markdownMode: 'code' }, {})
  expect((view as any).navigationEndLine.value).toBe(9)
  expect(file.markdownMode.value).toBe('code')
})

it('keeps the mounted file editor across same-file reveals but rebinds another file or target', async () => {
  const view = new NodePathMainView({} as WorkspaceLeaf, 'abele-node-file')
  views.push(view)
  view.app = { workspace: {} } as any
  const bind = vi.spyOn(view as any, 'startBinding').mockImplementation(() => {})
  const state = { kind: 'file', target, path: 'sample.ts' }
  ;(view as any).saved = state
  ;(view as any).ui = { unmount: vi.fn() }
  ;(view as any).editing = { active: shallowRef(true) }
  await view.setState(state, {})
  expect(bind).not.toHaveBeenCalled()
  expect(view.getState().edit).toBe(true)
  await view.setState({ ...state, path: 'other.ts' }, {})
  expect(bind).toHaveBeenCalledTimes(1)
  await view.setState({ ...state, target: { ...target, id: 'other-worktree' } }, {})
  expect(bind).toHaveBeenCalledTimes(2)
})

it('moves a chat tab of an earlier layout to the sidebar chat and closes it', async () => {
  const detach = vi.fn()
  const view = new NodePathMainView({ detach } as unknown as WorkspaceLeaf, 'abele-node-chat')
  views.push(view)
  view.app = { workspace: {} } as any
  const state = { kind: 'chat', target, sessionId: 'sample-session', title: 'Sample chat' }
  await view.setState(state, {})
  for (let i = 0; i < 20; i++) await Promise.resolve()
  expect(fixture.openChat).toHaveBeenCalledWith(state)
  expect(detach).toHaveBeenCalled()
})
afterEach(async () => {
  for (const view of views.splice(0)) await view.onClose()
  vi.clearAllMocks()
  fixture.installation = 'sample-installation'
  fixture.root = undefined
})

it.each([undefined, '', 'sample-installation'])(
  'keeps the file readable and binds repository tools only to a present installation: %s',
  async (installation) => {
    fixture.installation = installation
    fixture.connect.mockResolvedValue(undefined)
    fixture.model = {
      online: shallowRef(true),
      hasRetained: () => false,
      openFile: vi.fn(async () => ({
        target,
        path: 'sample.ts',
        text: 'sample',
        contentId: 'sample-content',
        revision: { kind: 'commit', commit: 'a'.repeat(40) },
      })),
    }
    const view = new NodePathMainView({} as WorkspaceLeaf, 'abele-node-file')
    views.push(view)
    view.app = { workspace: { requestSaveLayout() {} } } as any
    await view.setState({ kind: 'file', target, path: 'sample.ts' }, {})
    await vi.waitFor(() => expect((view as any).file?.document.value?.text).toBe('sample'))
    const props = fixture.root.render().props
    if (installation) expect(props.repository.identity.installation).toBe(installation)
    else expect(props.repository).toBeUndefined()
  }
)

it('shows binding failures instead of leaving an admitted tab blank', async () => {
  fixture.model = new Error('Sample node is unavailable')
  const view = new NodePathMainView({} as WorkspaceLeaf, 'abele-node-history')
  views.push(view)
  view.app = { workspace: {} } as any
  await view.setState({ kind: 'history', target }, {})
  for (let i = 0; i < 10; i++) await Promise.resolve()
  expect(view.containerEl.textContent).toContain('Sample node is unavailable')
})

it('retries the same tab state if its previous binding failed before mounting', async () => {
  fixture.model = new Error('Sample node is unavailable')
  const view = new NodePathMainView({} as WorkspaceLeaf, 'abele-node-history')
  views.push(view)
  view.app = { workspace: {} } as any
  const state = { kind: 'history', target }
  await view.setState(state, {})
  fixture.connect.mockResolvedValue(undefined)
  const history = vi.fn(async () => ({ entries: [], cursor: null }))
  fixture.model = { port: { history }, copy: () => undefined }
  await view.setState(state, {})
  for (let i = 0; i < 20; i++) await Promise.resolve()
  expect(history).toHaveBeenCalledTimes(1)
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
    const leaf = { setViewState: vi.fn(async () => {}), detach: vi.fn() }
    const view = new NodePathMainView(leaf as unknown as WorkspaceLeaf, `abele-node-${kind}`)
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
    if (kind === 'editor')
      await vi.waitFor(() =>
        expect(leaf.setViewState).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'abele-node-file',
            state: expect.objectContaining({ edit: true, path: 'sample.ts' }),
          })
        )
      )
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

it('opens the commit chosen in the panel, and another one in the same history tab', async () => {
  fixture.connect.mockResolvedValue(undefined)
  const commit = vi.fn(async (_t: unknown, hash: string) => ({ hash, subject: hash, files: [] }))
  fixture.model = {
    online: shallowRef(true),
    port: { history: vi.fn(async () => ({ entries: [], cursor: null })), commit },
    copy: () => undefined,
    inspections: shallowRef({}),
  }
  const view = new NodePathMainView({} as WorkspaceLeaf, 'abele-node-history')
  views.push(view)
  view.app = { workspace: { requestSaveLayout() {} } } as any
  await view.setState({ kind: 'history', target, commit: 'a1b2c3' }, {})
  await vi.waitFor(() => expect(commit).toHaveBeenCalledWith(target, 'a1b2c3'))
  await view.setState({ kind: 'history', target, commit: 'd4e5f6' }, {})
  await vi.waitFor(() => expect(commit).toHaveBeenCalledWith(target, 'd4e5f6'))
  expect(fixture.model.port.history).toHaveBeenCalledTimes(1)
})

it('keeps phone file actions in the pane menu', () => {
  const previous = Platform.isPhone
  Platform.isPhone = true
  try {
    const view = new NodePathMainView({} as WorkspaceLeaf, 'abele-node-file')
    views.push(view)
    // Editing is offered only for a loaded working file.
    ;(view as any).file = { document: shallowRef({ text: 'sample' }), destroy() {} }
    const titles: string[] = []
    const item = {
      setTitle(title: string) {
        titles.push(title)
        return this
      },
      setIcon() {
        return this
      },
      setSection() {
        return this
      },
      onClick() {
        return this
      },
    }
    view.onPaneMenu(
      {
        addItem(callback: (i: typeof item) => void) {
          callback(item)
        },
      } as never,
      'more-options'
    )
    expect(titles).toEqual([
      'Previous changed file',
      'Next changed file',
      'Edit the file',
      'Back to node',
    ])
  } finally {
    Platform.isPhone = previous
  }
})

it('turns the file tab’s header into save, discard and stop while editing, and saves on Cmd+S', async () => {
  const view = new NodePathMainView({} as WorkspaceLeaf, 'abele-node-file')
  views.push(view)
  view.app = { workspace: {} } as any
  const shown: { title: string; lit: boolean }[] = []
  ;(view as any).addAction = (_icon: string, title: string) => {
    const entry = { title, lit: false }
    shown.push(entry)
    return {
      toggleClass: (cls: string, on: boolean) => {
        if (cls === 'is-active') entry.lit = on
      },
      remove: () => shown.splice(shown.indexOf(entry), 1),
    }
  }
  const save = vi.fn(async () => {})
  const editing = {
    active: shallowRef(false),
    dirty: shallowRef(false),
    locked: shallowRef(false),
    save,
  }
  ;(view as any).editing = editing
  ;(view as any).file = { document: shallowRef({ text: 'sample' }), destroy() {} }
  ;(view as any).fileTab.render()
  expect(shown.map((a) => a.title)).toContain('Edit the file')
  editing.active.value = true
  editing.dirty.value = true
  ;(view as any).fileTab.render()
  expect(shown.map((a) => a.title)).toEqual([
    'Stop editing; the edits stay until you save or discard them',
    'Discard the edits',
    'Save to the node · ⌘ S',
  ])
  expect(shown.find((a) => a.title.startsWith('Save'))!.lit).toBe(true)
  await view.onOpen()
  const { Scope } = await import('obsidian')
  const answer = (view as any).scope.handleKey(new KeyboardEvent('keydown', { key: 's' }), {
    modifiers: Scope.compile(['Mod']),
    key: 's',
  })
  expect(answer).toBe(false)
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
})

it('reopens an editor tab of an earlier version as the file tab, editing, once it is admitted', async () => {
  vi.useFakeTimers()
  try {
    const setViewState = vi.fn(async () => {})
    const view = new NodePathMainView(
      { setViewState } as unknown as WorkspaceLeaf,
      'abele-node-editor'
    )
    views.push(view)
    view.app = { workspace: {} } as any
    await view.setState({ kind: 'editor', target, path: 'sample.ts' }, {})
    expect(setViewState).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(setViewState).toHaveBeenCalledWith({
      type: 'abele-node-file',
      active: true,
      state: { kind: 'file', target, path: 'sample.ts', edit: true },
    })
  } finally {
    vi.useRealTimers()
  }
})

it('routes the host current-file search command to the active file tools', async () => {
  const view = new NodePathMainView({} as WorkspaceLeaf, 'abele-node-file')
  views.push(view)
  const action = document.createElement('button')
  action.dataset.nodeFind = ''
  const click = vi.fn()
  action.onclick = click
  view.contentEl.append(action)
  const file = { mode: shallowRef('diff'), destroy: vi.fn() }
  ;(view as any).file = file
  expect(typeof (view as any).showSearch).toBe('function')
  await (view as any).showSearch()
  expect(file.mode.value).toBe('file')
  expect(click).toHaveBeenCalledOnce()
})
