/**
 * The node side panel on invented data, for layout probes that run no node.
 *
 * The node workspaces window used to be measured through `openDialog('node-workspaces')`. Its
 * folders, worktrees, chats and actions now live in the node panel (`abele-node-sidebar`): a place
 * row, the modes in its header and the place's menu. This fixture puts a registration and a
 * connection holding a non-executing client beside the real ones (as `nodeRepositoryScreen.ts`
 * and the phone probe's node screens do), opens the real panel on it, and takes both away again.
 * Nothing is persisted: the registry, the keychain and the panel's own cache are left as found.
 *
 * Paste `NODE_PANEL_FIXTURE` into an `eval`'d async function; it declares `nodePanel`:
 * - `open(place)` — the panel in the left sidebar (the drawer on a phone) on `feature` (a worktree
 *   with changes, ahead of and behind its base), `root` (the repository's own folder) or `notes`
 *   (a folder without git); resolves to the panel's root element once its place and modes are shown;
 * - `root()`, `select(place)`, `mode('Files' | 'Changes' | 'History' | 'Pull requests' | 'Sessions')`;
 * - `menu()` — the place's `…` menu, built; `items(menu)` its titles; `places()` the place search;
 *   `newChat()` the agent choice `New chat here` opens; `dismiss()` closes a menu or prompt;
 * - `close()` — removes the panel, the registration and the connection.
 * - `variant` — set before `open` for the states a picture needs: `{ git }` (the node offers git
 *   writes), `{ staged: false }` (nothing staged), `{ conflict }` (a rebase stopped on a file),
 *   `{ many: n }` (n more changed files), `{ empty }` (no folder opened yet), `{ offline }`,
 *   `{ waiting }` (the layout chat waits for the owner's answer).
 */
export const NODE_PANEL = {
  node: 'Sample node',
  repository: 'sample-repository',
  root: 'main',
  feature: 'feature/sample-panel-layout-with-a-long-branch-name',
  featureFolder: 'sample-panel-layout-worktree-with-a-longer-folder-name',
  notes: 'sample-notes',
  chat: 'Sample chat about the panel layout',
  diagnostic: 'Sample agent unavailable on the node',
} as const

export const NODE_PANEL_FIXTURE = `
const nodePanel = (() => {
  const names = ${JSON.stringify(NODE_PANEL)}
  const variant = {}
  let observations = 0
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFor = async (fn, what, ms = 10000) => {
    for (const end = Date.now() + ms; Date.now() < end; ) {
      const value = fn()
      if (value) return value
      await pause(50)
    }
    throw Error('Node panel fixture: ' + what + ' did not show')
  }
  const shown = (el) => { const r = el?.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0 }
  const ids = {
    project: 'sample-repository-project', folder: 'sample-notes-project', notes: 'sample-notes-workspace',
    root: 'sample-root-worktree', feature: 'sample-feature-worktree', unlisted: 'sample-unlisted-worktree',
  }
  const HEAD = 'b'.repeat(40), BASE = 'a'.repeat(40), at = '2025-01-01T10:00:00.000Z'
  const page = (entries, extra = {}) => ({ entries, cursor: null, incomplete: false, omissions: [], ...extra })
  const worktree = (id, kind, label, branch, extra = {}) => ({
    worktree_id: id, project_id: ids.project, workspace_id: id + '-workspace', kind, path_label: label,
    branch: 'refs/heads/' + branch, detached: false, head: HEAD, availability: 'available', locked: false,
    prunable: false, dirty: true, listed: true, ...extra,
  })
  const worktrees = [
    worktree(ids.root, 'root', names.repository, names.root, { dirty: false }),
    worktree(ids.feature, 'managed', names.featureFolder, names.feature),
    worktree(ids.unlisted, 'external', 'sample-unlisted-worktree', 'sample-unlisted', { workspace_id: null, listed: false, dirty: false }),
  ]
  const allProjects = [
    { project_id: ids.project, root_path: '/sample/projects/' + names.repository, repository_path: '/sample/projects/' + names.repository, trust: 'trusted', use_repository_claude_permissions: false, created_at: at },
    { project_id: ids.folder, root_path: '/sample/notes/' + names.notes, repository_path: null, trust: 'trusted', use_repository_claude_permissions: false, created_at: at },
  ]
  const projects = () => (variant.empty ? [] : allProjects)
  const sessions = [
    { session_id: 'sample-layout-chat', title: names.chat, provider: 'claude', workspace_id: ids.feature + '-workspace', created_at: at, updated_at: at },
    { session_id: 'sample-notes-chat', title: 'Sample notes chat', provider: 'pi', workspace_id: ids.notes, created_at: at, updated_at: at },
  ]
  const commit = (hash, subject) => ({ commit: hash, parents: hash === BASE ? [] : [BASE], author: 'Sample author', email: 'sample@example.invalid', authored_at: at, subject, message: subject + '\\n' })
  const supported = { status: 'supported', evidence: 'sample-fixture' }
  const client = {
    channel: { channel: { welcome: { get methods() { return variant.codexNetwork ? ['project.codex_permissions'] : [] } } } },
    setProjectCodexPermissions: async (id, enabled) => {
      const project = allProjects.find((p) => p.project_id === id)
      project.codex_network_enabled = enabled
      return { ...project }
    },
    connected: true,
    describe: async () => ({
      capabilities: { capabilities: { node_path_v2: supported, node_path_worktrees: supported, node_path_execution: supported, repository_git_write_v1: supported } },
      providers: [
        { provider: 'pi', available: true, configuration: { profile: 'isolated', model: 'sample-model' }, capabilities: { compaction: { status: 'unverified', reason: 'Compaction not accepted' } } },
        { provider: 'codex', available: false, diagnostic: names.diagnostic },
        { provider: 'claude', available: true, configuration: { profile: 'inherited' }, capabilities: { steering: { status: 'unsupported', reason: 'Serialized follow-ups only' } } },
      ],
    }),
    listProjects: async (after) => (after ? [] : projects()),
    listSessions: async (after) => (after ? [] : sessions.map((s) => (variant.waiting && s.session_id === 'sample-layout-chat' ? { ...s, settings: { permission_mode: 'bypassPermissions' } } : s))),
    listWorkspaces: async (project, after) =>
      after || project !== ids.folder ? [] : [{ workspace_id: ids.notes, project_id: ids.folder, path: allProjects[1].root_path, kind: 'root', state: 'ready', created_at: at }],
    listFiles: async (_id, path) => ({ entries: path ? [] : [{ name: 'sample-note.md', path: 'sample-note.md', kind: 'file' }, { name: 'drafts', path: 'drafts', kind: 'directory' }], next: null }),
    getProject: async (id) => ({ ...allProjects.find((p) => p.project_id === id) }),
    request: async (method) => {
      if (method === 'project.repository_settings.get') return { external_read: false }
      throw Error('Unsupported fixture call: ' + method)
    },
    onEvent: () => () => {},
    subscribe: async () => ({}),
    // \`{ waiting }\`: the layout chat asks the owner a question, its journal says so.
    store: { transaction: async (fn) => fn({ events: variant.waiting ? { 'sample-layout-chat': [
      { kind: 'event', node_id: 'sample-panel-node', stream_id: 'sample-layout-chat', seq: 1, type: 'turn.started', data: { run_id: 'sample-process', turn_id: 't', trigger: 'input' }, actor: { kind: 'node' }, at: new Date(Date.now() - 5 * 60000).toISOString() },
      { kind: 'event', node_id: 'sample-panel-node', stream_id: 'sample-layout-chat', seq: 2, type: 'prompt.requested', data: { prompt_id: 'sample-question', run_id: 'sample-process', state: 'pending' }, actor: { kind: 'node' }, at: new Date(Date.now() - 5 * 60000).toISOString() },
    ] } : {}, results: {} }) },
    nodePath: {
      divergence: async ({ worktree_id, base_ref }) =>
        worktree_id === ids.feature
          ? { ahead: 2, behind: 1, base_ref: base_ref ?? 'refs/heads/' + names.root, base_commit: BASE, head_commit: HEAD, reason: 'ok' }
          : { ahead: 0, behind: 0, base_ref: base_ref ?? 'refs/heads/' + names.root, base_commit: HEAD, head_commit: HEAD, reason: 'ok' },
      sessionWorktreeGet: async ({ session_id }) =>
        session_id === 'sample-notes-chat'
          ? { project_id: ids.folder, target: { kind: 'workspace', workspace_id: ids.notes } }
          : { project_id: ids.project, target: { kind: 'worktree', worktree_id: ids.feature } },
      watch: async () => ({ subscription_id: 'sample-folder-watch', expires_at: new Date(Date.now() + 600000).toISOString(), refresh_required: false }),
      unwatch: async () => ({ removed: true }),
    },
    repository: {
      resolve: async () => ({ kind: 'commit', commit: BASE }),
      blob: async () => ({ content_id: 'sample-file', size: 29, binary: false, requires_larger_load: false, too_large: false }),
      patch: async () => ({ content_id: 'sample-patch', size: 100, binary: false, requires_larger_load: false, too_large: false }),
      content: async ({ content_id }) => {
        const text = content_id === 'sample-patch'
          ? '@@ -1 +1 @@\\n-export const sample = false\\n+export const sample = true\\n'
          : 'export const sample = true\\n'
        return { offset: 0, total: text.length, base64: btoa(text) }
      },
      worktrees: async ({ project_id }) => page(worktrees.filter((w) => w.project_id === project_id)),
      // A new observation each time, as the node gives, so answers changed by a variant are read.
      observe: async ({ worktree_id }) => ({ revision: { kind: 'working', observation_id: 'sample-observation-' + worktree_id + '-' + ++observations, head: HEAD, observed_at: at }, atomic: false }),
      status: async ({ worktree_id }) =>
        page(worktree_id === ids.feature
          ? [
              { path: 'src/sample-panel.ts', index: variant.conflict ? 'U' : ' ', worktree: variant.conflict ? 'U' : 'M' },
              { path: 'src/components/sample-new-file-with-a-rather-long-name.vue', index: '?', worktree: '?' },
              { path: 'docs/sample-guide.md', index: variant.staged === false ? ' ' : 'M', worktree: 'M' },
              ...Array.from({ length: variant.many ?? 0 }, (_, i) => ({ path: 'src/many/sample-file-' + String(i).padStart(3, '0') + '.ts', index: ' ', worktree: 'M' })),
            ]
          : []),
      history: async () => page([commit(HEAD, 'Sample change to the panel layout'), commit(BASE, 'Sample first commit')]),
      tree: async ({ path }) =>
        page(path === 'src'
          ? [{ name: 'components', path: 'src/components', kind: 'directory' }, { name: 'sample-panel.ts', path: 'src/sample-panel.ts', kind: 'file', oid: null, size: 20 }]
          : path === 'src/components'
            ? [{ name: 'sample-new-file-with-a-rather-long-name.vue', path: 'src/components/sample-new-file-with-a-rather-long-name.vue', kind: 'file', oid: null, size: 20 }]
            : path === 'docs'
              ? [{ name: 'sample-guide.md', path: 'docs/sample-guide.md', kind: 'file', oid: null, size: 20 }]
              : path
                ? []
                : [
                    { name: 'docs', path: 'docs', kind: 'directory' },
                    { name: 'src', path: 'src', kind: 'directory' },
                    { name: 'README.md', path: 'README.md', kind: 'file', oid: HEAD, size: 20 },
                  ]),
      refs: async () =>
        page([
          { name: 'refs/heads/' + names.root, commit: BASE, symbolic: null },
          { name: 'refs/heads/' + names.feature, commit: HEAD, symbolic: null },
          { name: 'refs/remotes/origin/' + names.root, commit: BASE, symbolic: null },
          { name: 'refs/tags/sample-1.0.0', commit: BASE, symbolic: null },
        ], { default_branch: names.root }),
      compare: async ({ base, head, mode }) =>
        page([{ path: 'src/sample-committed.ts', status: 'M' }], { comparison_id: 'sample-comparison', base, head, mode: mode || 'endpoint' }),
      watch: async () => ({ subscription_id: 'sample-worktree-watch', expires_at: new Date(Date.now() + 600000).toISOString(), refresh_required: false }),
      unwatch: async () => ({ removed: true }),
      gitWrites: {
        info: async () => ({
          head: HEAD, branch: 'refs/heads/' + names.feature, detached: false,
          operation: variant.conflict ? { kind: 'rebase', conflicted_paths: ['src/sample-panel.ts'] } : null,
          upstream: { ref: 'refs/remotes/origin/' + names.feature, remote: 'origin', branch: 'refs/heads/' + names.feature, ahead: 1, behind: 0 },
          default_branch: 'refs/heads/' + names.root,
          remotes: [{ name: 'origin', url: 'https://example.invalid/sample.git', forge: null }],
          author: { name: 'Sample author', email: 'sample@example.invalid' },
        }),
        stage: async () => ({ state: 'applied', head: HEAD }),
        unstage: async () => ({ state: 'applied', head: HEAD }),
        discard: async () => ({ state: 'applied', head: HEAD, discarded: [] }),
        commit: async () => ({ state: 'committed', commit: HEAD, parent: BASE, author: { name: 'Sample author', email: 'sample@example.invalid' } }),
        update: async () => ({ state: 'updated', strategy: 'rebase', previous_head: HEAD, head: HEAD, base_ref: names.root, base_commit: BASE, changed: false }),
        continue: async () => ({ state: 'continued', head: HEAD }),
        abort: async () => ({ state: 'aborted', head: HEAD }),
        push: async () => ({ state: 'pushed', remote: 'origin', branch: 'refs/heads/' + names.feature, upstream: 'refs/remotes/origin/' + names.feature, set_upstream: false, commit: HEAD }),
      },
    },
  }
  // The node says it can write git, but its client speaks git only in the variant that asks for
  // it, whenever that is set: without it the panel shows no git action, as with the e2e node.
  Object.defineProperty(client.repository, 'git', { get: () => (variant.git ? client.repository.gitWrites : undefined) })
  const connection = {
    client, state: { value: 'connected' }, error: { value: '' }, authorizationGeneration: 0,
    delegationCards: { value: {} }, connect: async () => {}, start: () => {}, destroy: () => {},
    refreshDelegations: async () => {},
  }
  const placeName = { root: names.root, feature: names.feature, notes: names.notes }
  const fixture = () => window.__abeleNodePanelFixture
  const root = () => fixture()?.leaf.view.contentEl
  const escape = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
  const open = () => document.querySelector('.menu, .modal-container > .prompt')
  const dismiss = async () => {
    for (let i = 0; i < 3 && open(); i++) {
      escape()
      for (let j = 0; j < 20 && open(); j++) await pause(50)
      // A native prompt is dismissed by a press outside it, as on a phone.
      document.querySelector('.modal-container > .prompt')?.parentElement?.querySelector('.modal-bg')?.click()
    }
    if (open()) throw Error('Node panel fixture: a menu or prompt did not close')
  }
  // On a phone the panel is a drawer, and a menu dismissed by a press outside closes it too;
  // a person presses the panel's own controls only with the drawer open.
  const reveal = async () => {
    if (!app.workspace.leftSplit.collapsed) return
    await app.workspace.revealLeaf(fixture().leaf)
    app.workspace.leftSplit.expand()
    await pause(300)
  }
  const select = async (place) => {
    const { model } = fixture()
    await reveal()
    // A place is pictured from its first view: history and pull requests carry over from the
    // last place by design, so the mode is set back as a new panel would open it.
    model.panelMode.value = 'files'
    await model.select(place === 'notes' ? ids.folder : place === 'root' ? ids.root : ids.feature)
    const panel = await waitFor(() => root()?.querySelector('.abele-node-place__name')?.textContent.trim() === placeName[place] && root(), 'place ' + place)
    await waitFor(() => panel.querySelector('.abele-node-modes [role="tab"]'), 'modes')
    if (place === 'feature') {
      await waitFor(() => panel.querySelector('.abele-file-tree__group'), 'change groups')
      await waitFor(() => panel.querySelector('.abele-branch-codes__drift'), 'branch codes')
    } else await waitFor(() => panel.querySelector('.abele-file-tree .tree-item-self[data-path]'), 'files')
    await pause(250)
    return panel
  }
  const contentOf = {
    Files: (panel) => panel.querySelector('.abele-file-tree .tree-item-self[data-path]'),
    Changes: (panel) => panel.querySelector('.abele-file-tree__group'),
    History: (panel) => panel.querySelector('.abele-node-sidebar__history .abele-history__row-subject'),
    'Pull requests': (panel) => panel.querySelector('.abele-node-pulls'),
    Sessions: (panel) => panel.querySelector('.abele-node-sidebar__sessions .abele-session-row'),
  }
  return {
    names,
    variant,
    root,
    select,
    dismiss,
    async open(place = 'feature') {
      if (fixture()) await this.close()
      const nodes = window.__abeleTest.NodeService.getInstance()
      const paths = window.__abeleTest.NodePathService.getInstance()
      const registration = { id: 'sample-panel-' + Math.random().toString(36).slice(2, 10), label: names.node, url: 'http://127.0.0.1:1', expectedNodeId: 'sample-panel-node' }
      const state = { nodes, registration, wasNodes: nodes.nodes.value, wasCollapsed: app.workspace.leftSplit.collapsed }
      window.__abeleNodePanelFixture = state
      nodes.connections.set(registration.id, connection)
      nodes.nodes.value = [...state.wasNodes, registration]
      state.leaf = app.workspace.getLeftLeaf(false)
      await state.leaf.setViewState({ type: 'abele-node-sidebar', active: true, state: { registrationId: registration.id } })
      await app.workspace.revealLeaf(state.leaf)
      app.workspace.leftSplit.expand()
      await paths.ready(registration.id)
      state.model = paths.model(registration.id)
      if (state.model.error.value) throw Error('Node panel fixture: ' + state.model.error.value)
      return select(place)
    },
    async mode(label) {
      const panel = root()
      const tab = [...panel.querySelectorAll('.abele-node-modes [role="tab"]')].find((t) => t.getAttribute('aria-label')?.startsWith(label))
      if (!tab) throw Error('Node panel fixture: no mode ' + label)
      tab.click()
      await waitFor(() => tab.getAttribute('aria-selected') === 'true' && contentOf[label](panel), 'mode ' + label)
      await pause(250)
      return panel
    },
    async menu() {
      await reveal()
      root().querySelector('.abele-node-place > .abele-obsidian-icon').click()
      const menu = await waitFor(() => [...document.querySelectorAll('.menu')].find((m) => shown(m) && m.textContent.includes('Open a folder…')), 'place menu')
      await pause(250)
      return menu
    },
    items: (menu) => [...menu.querySelectorAll('.menu-item')].map((item) => ({
      title: item.querySelector('.menu-item-title')?.textContent.trim() ?? '',
      warning: item.classList.contains('is-warning'),
      disabled: item.classList.contains('is-disabled'),
    })),
    async places() {
      await reveal()
      root().querySelector('.abele-node-place__row').click()
      const prompt = await waitFor(() => [...document.querySelectorAll('.modal-container > .prompt')].find((p) => shown(p) && p.querySelector('.suggestion-item')), 'place search')
      await pause(250)
      return prompt
    },
    async newChat() {
      const menu = await this.menu()
      const item = [...menu.querySelectorAll('.menu-item')].find((i) => i.querySelector('.menu-item-title')?.textContent.trim() === 'New chat here')
      if (!item || item.classList.contains('is-disabled')) throw Error('Node panel fixture: New chat here is not offered')
      item.click()
      const prompt = await waitFor(() => [...document.querySelectorAll('.modal-container > .prompt')].find((p) => shown(p) && p.querySelector('.suggestion-item.abele-node-suggestion')), 'agent choice')
      await pause(250)
      return prompt
    },
    async close() {
      const state = fixture()
      if (!state) return
      delete window.__abeleNodePanelFixture
      try {
        await dismiss()
      } finally {
        state.leaf?.detach()
        state.nodes.nodes.value = state.wasNodes
        state.nodes.connections.delete(state.registration.id)
        app.saveLocalStorage('abele-node-path-cache:' + state.registration.id, null)
        if (state.wasCollapsed) app.workspace.leftSplit.collapse()
      }
    },
  }
})()
`
