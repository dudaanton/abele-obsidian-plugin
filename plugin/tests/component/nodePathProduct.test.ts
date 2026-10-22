import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, shallowRef } from 'vue'
import NodePathSidebar from '@/components/nodeWork/NodePathSidebar.vue'
import PairDialog from '@/components/nodeWork/PairDialog.vue'
import FileTree from '@/components/nodeWork/FileTree.vue'
import HistoryView from '@/components/nodeWork/HistoryView.vue'
import NodePanel from '@/components/nodeWork/NodePanel.vue'

// The sidebar asks the node service for the folder's Codex network setting; this fake node advertises
// no such method, so the globe stays hidden and nothing is loaded.
vi.mock('@/node/NodeService', () => ({
  NodeService: { getInstance: () => ({ connection: () => ({ client: {} }) }) },
}))

const parse = () => ({
  name: 'Sample node',
  host: 'sample.ts.net',
  port: 443,
  fingerprint: 'a'.repeat(64),
  expires: 'Today, 12:00',
})
describe('product node sidebar', () => {
  it('composes the place and its files and retains their content with a disconnected dot', async () => {
    const model = {
      folders: shallowRef([
        {
          id: 'project',
          name: 'Sample',
          path: '/sample',
          git: true,
          copies: [{ id: 'tree', kind: 'project', branch: 'trunk', path: '/sample', changed: 1 }],
        },
      ]),
      selected: ref('tree'),
      current: ref({ id: 'tree' }),
      selectedChat: ref(''),
      currentFolder: ref({ name: 'Sample', git: true }),
      currentCopy: ref({ branch: 'trunk' }),
      entries: shallowRef([]),
      treeCursors: shallowRef({}),
      treeProgress: shallowRef(undefined),
      loadFolder: vi.fn(async () => {}),
      loadMore: vi.fn(async () => {}),
      changes: shallowRef([
        {
          path: 'sample.ts',
          kind: 'modified',
          stage: 'partly',
          before: '',
          after: '',
          added: 0,
          removed: 0,
        },
      ]),
      panelMode: ref('changes'),
      panelBase: ref(''),
      panelBranch: shallowRef(undefined),
      loadPanelBranch: vi.fn(async () => {}),
      panelHistory: shallowRef(undefined),
      panelPulls: shallowRef(undefined),
      inspection: shallowRef(undefined),
      loadPanelHistory: vi.fn(async () => {}),
      loadPanelPulls: vi.fn(async () => {}),
      unavailable: ref(false),
      error: ref(''),
      busy: ref(false),
      capabilities: shallowRef<string[]>([]),
    }
    const view = mount(NodePathSidebar, {
      props: {
        model: model as never,
        phase: 'ready',
        node: { name: 'Sample node', status: 'offline', seen: 'Today, 12:00' },
      },
    })
    expect(view.text()).toContain('Loading the file changes…')
    expect(view.findComponent(FileTree).exists()).toBe(false)
    model.inspection.value = { entries: [], changes: model.changes.value } as never
    await flushPromises()
    expect(view.get('.abele-node-place__name').text()).toBe('trunk')
    expect(view.get('.abele-node-place__where').text()).toBe('Sample')
    expect(view.find('.abele-file-tree_stale').exists()).toBe(true)
    expect(view.text()).toContain('sample.ts')
    model.panelBase.value = 'refs/heads/release'
    view.getComponent(FileTree).vm.$emit('open', 'committed.ts', 'committed')
    expect(view.emitted('open-file')?.at(-1)).toEqual([
      'committed.ts',
      { kind: 'committed', base: 'refs/heads/release' },
    ])
    view.getComponent(FileTree).vm.$emit('open', 'sample.ts', 'staged')
    expect(view.emitted('open-file')?.at(-1)).toEqual(['sample.ts', 'staged'])
    model.panelBase.value = ''
    expect(view.text()).toContain('As of Today, 12:00')
    // A copy whose last commit and distance are unknown says nothing of them.
    expect(view.text()).not.toContain('Unknown')
    expect(view.find('.abele-node-sidebar__facts').exists()).toBe(false)
    // The node's items are in the place's menu, with the modes in the header.
    await view.get('.abele-node-place > .abele-obsidian-icon').trigger('click')
    expect(view.emitted('place-menu')).toHaveLength(1)
    await view.get('.abele-node-place__row').trigger('click')
    expect(view.emitted('pick-place')).toHaveLength(1)
    const modes = view.findAll('.abele-node-modes [role="tab"]')
    expect(modes.map((m) => m.attributes('aria-label'))).toEqual([
      'Files',
      'Changes: 1 file',
      'History',
      'Pull requests: none open',
      'Sessions: 0',
    ])
    await modes[2].trigger('click')
    expect(model.panelMode.value).toBe('history')
    await flushPromises()
    expect(model.loadPanelHistory).toHaveBeenCalled()
    await view.findAll('.abele-node-modes [role="tab"]')[3].trigger('click')
    await flushPromises()
    expect(model.loadPanelPulls).toHaveBeenCalled()
    expect(view.text()).toContain('does not say which remote')
    view.unmount()
  })
  it('keeps an expanded file directory expanded across a live tree refresh', async () => {
    const entries = [
      {
        path: 'src',
        name: 'src',
        kind: 'folder' as const,
        children: [{ path: 'src/sample.ts', name: 'sample.ts', kind: 'file' as const }],
      },
    ]
    const view = mount(FileTree, { props: { entries, changes: [], mode: 'all' } })
    await view.find('.tree-item-self').trigger('click')
    expect(view.text()).toContain('sample.ts')
    await view.setProps({ entries: structuredClone(entries) })
    expect(view.text()).toContain('sample.ts')
    view.unmount()
  })
  it('opens a partly-staged file with the group stage, not the sidebar global mode', async () => {
    const view = mount(FileTree, {
      props: {
        entries: [],
        changes: [
          {
            path: 'sample.ts',
            kind: 'modified',
            stage: 'partly',
            before: '',
            after: '',
            added: 0,
            removed: 0,
          },
        ],
        mode: 'changed',
      },
    })
    const matches = view.findAll('.tree-item-self').filter((r) => r.text().includes('sample.ts'))
    await matches[1].trigger('click')
    expect(view.emitted('open')?.[0]).toEqual(['sample.ts', 'staged'])
    view.unmount()
  })
})
describe('file lookup and exclusions', () => {
  it('matches pasted relative paths, ranks names first, and does not duplicate hits', async () => {
    const view = mount(FileTree, {
      props: {
        mode: 'all',
        changes: [],
        entries: [
          { path: 'topic/other.txt', name: 'other.txt', kind: 'file' },
          { path: 'src/topic.txt', name: 'topic.txt', kind: 'file' },
        ],
      },
    })
    await view.find('input').setValue('topic')
    expect(view.findAll('.tree-item-self').map((r) => r.text())).toEqual([
      'topic.txtsrc',
      'other.txttopic',
    ])
    await view.find('input').setValue(' TOPIC/OTHER.TXT ')
    expect(view.findAll('.tree-item-self')).toHaveLength(1)
    expect(view.text()).toContain('other.txt')
    view.unmount()
  })
  it('states the full match count when the rendered list is capped and updates on refinement', async () => {
    const view = mount(FileTree, {
      props: {
        mode: 'all',
        changes: [],
        entries: Array.from({ length: 73 }, (_, i) => ({
          path: `item-${i}.txt`,
          name: `item-${i}.txt`,
          kind: 'file' as const,
        })),
      },
    })
    await view.find('input').setValue('item')
    expect(view.findAll('.tree-item-self')).toHaveLength(50)
    expect(view.text()).toContain('50 of 73 · type more to narrow')
    await view.find('input').setValue('item-72')
    expect(view.text()).not.toContain('type more')
    view.unmount()
  })
  it('explains ignored-file exclusion for Git all-files and lookup, not plain folders or changes', async () => {
    const view = mount(FileTree, { props: { mode: 'all', entries: [], changes: [] } })
    expect(view.text()).toContain('Ignored files are not shown.')
    await view.setProps({ mode: 'changed' })
    expect(view.text()).not.toContain('Ignored files are not shown.')
    await view.find('input').setValue('ignored')
    expect(view.text()).toContain('Ignored files are not shown.')
    await view.setProps({ git: false })
    expect(view.text()).not.toContain('Ignored files are not shown.')
    view.unmount()
  })
})
describe('native node installation', () => {
  it('shows and copies the supported installer command without running it', async () => {
    const view = mount(NodePanel, { props: { phase: 'not-found' } })
    const command =
      'curl -fsSL https://raw.githubusercontent.com/dudaanton/abele-node/main/install.sh | sh'
    expect(view.find('code').text()).toBe(command)
    await view.find('[aria-label="Copy the command"]').trigger('click')
    expect(view.emitted('copy')?.[0]).toEqual([command])
    view.unmount()
  })
})
describe('the branch in the panel', () => {
  function branchModel(base = '') {
    return {
      folders: shallowRef([
        { id: 'project', name: 'sample-app', path: '/sample', git: true, copies: [] },
      ]),
      selected: ref('tree'),
      current: ref({ id: 'tree', kind: 'worktree' }),
      selectedChat: ref(''),
      currentFolder: ref({ name: 'sample-app', git: true }),
      currentCopy: ref({ kind: 'worktree', branch: 'sample-branch' }),
      entries: shallowRef([]),
      treeCursors: shallowRef({}),
      treeProgress: shallowRef(undefined),
      changes: shallowRef([
        {
          path: 'src/a.ts',
          kind: 'modified',
          stage: 'staged',
          before: '',
          after: '',
          added: 0,
          removed: 0,
        },
      ]),
      panelMode: ref('changes'),
      panelBase: ref(base),
      panelBranch: shallowRef({
        state: { base: 'main', ahead: 2, behind: 1, unpushed: 0, upstream: 'origin/sample-branch' },
        committed: [
          { path: 'src/b.ts', kind: 'added', before: '', after: '', added: 0, removed: 0 },
        ],
        refs: [],
      }),
      panelHistory: shallowRef(undefined),
      panelPulls: shallowRef(undefined),
      inspection: shallowRef({ entries: [], changes: [] }),
      loadPanelBranch: vi.fn(async () => {}),
      loadPanelHistory: vi.fn(async () => {}),
      loadPanelPulls: vi.fn(async () => {}),
      unavailable: ref(false),
      error: ref(''),
      busy: ref(false),
      capabilities: shallowRef<string[]>([]),
    }
  }
  it('says the branch against its base under its name, and splits its changes into groups', async () => {
    const model = branchModel()
    const view = mount(NodePathSidebar, {
      props: {
        model: model as never,
        phase: 'ready',
        node: { name: 'Sample node', status: 'connected' },
      },
    })
    await flushPromises()
    expect(model.loadPanelBranch).toHaveBeenCalled()
    expect(view.get('.abele-node-place__byline .abele-branch-codes__base').text()).toBe('main')
    const groups = view
      .findAll('.abele-file-tree__group')
      .map((g) => g.get('.abele-tree-item__text').text())
    expect(groups).toEqual(['Staged', 'Committed'])
    // No stage glyphs while the node cannot stage.
    expect(view.find('[aria-label="Unstage"]').exists()).toBe(false)
    await view.get('.abele-branch-codes__base').trigger('click')
    expect(view.emitted('compare')).toHaveLength(1)
    view.unmount()
  })
  it('shows an unavailable folder notice and unregister action instead of a stale branch and files', () => {
    const model = branchModel()
    model.unavailable.value = true
    Object.assign(model.currentFolder.value, { missing: true })
    model.error.value = 'repository_unavailable'
    const view = mount(NodePathSidebar, {
      props: {
        model: model as never,
        phase: 'ready',
        node: { name: 'Sample node', status: 'connected' },
      },
    })
    expect(view.get('[role="alert"]').text()).toContain('no longer available')
    expect(view.text()).not.toContain('choose it again')
    expect(view.get('.abele-node-place__name').text()).toBe('sample-app')
    expect(view.find('.abele-file-tree').exists()).toBe(false)
    expect(view.get('[role="alert"] button').text()).toBe('Remove the folder from the node…')
    view.unmount()
  })
  it('names the chosen base over the files and goes back to the default with its cross', async () => {
    const model = branchModel('refs/heads/other')
    const view = mount(NodePathSidebar, {
      props: {
        model: model as never,
        phase: 'ready',
        node: { name: 'Sample node', status: 'connected' },
      },
    })
    expect(view.get('.abele-node-modes__against-name').text()).toBe('vs other')
    await view.get('.abele-node-modes__against [aria-label^="Stop comparing"]').trigger('click')
    expect(model.panelBase.value).toBe('')
    view.unmount()
  })
})
describe('git actions in the panel', () => {
  function gitModel(staged: boolean, state: Record<string, unknown> = {}) {
    const stage = vi.fn(async () => {})
    const commit = vi.fn(async () => ({ commit: 'c', author: 'Sample Person' }))
    const model = {
      folders: shallowRef([
        { id: 'project', name: 'sample-app', path: '/sample', git: true, copies: [] },
      ]),
      selected: ref('tree'),
      current: ref({ id: 'tree', kind: 'worktree' }),
      selectedChat: ref(''),
      currentFolder: ref({ name: 'sample-app', git: true }),
      currentCopy: ref({ kind: 'worktree', branch: 'sample-branch' }),
      entries: shallowRef([]),
      treeCursors: shallowRef({}),
      treeProgress: shallowRef(undefined),
      changes: shallowRef([
        {
          path: 'src/a.ts',
          kind: 'modified',
          stage: staged ? 'staged' : 'unstaged',
          before: '',
          after: '',
          added: 0,
          removed: 0,
        },
      ]),
      panelMode: ref('changes'),
      panelBase: ref(''),
      panelBranch: shallowRef({
        state: {
          base: 'main',
          ahead: 1,
          behind: 0,
          unpushed: 1,
          upstream: 'origin/sample-branch',
          ...state,
        },
        committed: [],
        refs: [],
      }),
      panelHistory: shallowRef(undefined),
      panelPulls: shallowRef(undefined),
      inspection: shallowRef({ entries: [], changes: [] }),
      gitBusy: ref(''),
      port: { git: {}, createPull: vi.fn() },
      stage,
      unstage: vi.fn(async () => {}),
      commit,
      continueStopped: vi.fn(async () => ({ conflicts: [] })),
      abortStopped: vi.fn(async () => {}),
      loadPanelBranch: vi.fn(async () => {}),
      loadPanelHistory: vi.fn(async () => {}),
      loadPanelPulls: vi.fn(async () => {}),
      report: vi.fn(),
      unavailable: ref(false),
      error: ref(''),
      busy: ref(false),
      capabilities: shallowRef<string[]>(['repository_git_write_v1']),
    }
    const view = mount(NodePathSidebar, {
      props: {
        model: model as never,
        phase: 'ready',
        node: { name: 'Sample node', status: 'connected' },
      },
    })
    return { model, view }
  }
  it('stages a file from its row and shows the branch’s next step while nothing is staged', async () => {
    const { model, view } = gitModel(false)
    await view.get('[aria-label="Stage"]').trigger('click')
    expect(model.stage).toHaveBeenCalledWith(['src/a.ts'])
    expect(view.find('.abele-commit-box').exists()).toBe(false)
    const step = view.get('.abele-node-sidebar__step button')
    expect(step.text()).toBe('Push 1')
    await step.trigger('click')
    expect(view.emitted('step')?.[0]).toEqual(['push'])
    await view.get('[aria-label="Discard the changes to this file…"]').trigger('click')
    expect(view.emitted('discard')?.[0]).toEqual(['src/a.ts'])
    view.unmount()
  })
  it('has one action while something is staged: the commit, and no step', async () => {
    const { model, view } = gitModel(true)
    expect(view.find('.abele-node-sidebar__step').exists()).toBe(false)
    await view.get('textarea').setValue('Sample summary')
    await view.get('textarea').trigger('keydown', { key: 'Enter', metaKey: true })
    expect(model.commit).toHaveBeenCalledWith('Sample summary')
    view.unmount()
  })
  it('offers to go on or stop a rebase that stopped, instead of a step', async () => {
    const { model, view } = gitModel(false, {
      stopped: { kind: 'rebase', onto: 'main', conflicts: 2 },
    })
    expect(view.find('.abele-node-sidebar__step').exists()).toBe(false)
    const line = view.get('.abele-node-sidebar__stopped')
    expect(line.text()).toContain('The rebase onto main stopped · 2 in conflict')
    await line
      .findAll('button')
      .find((b) => b.text() === 'Stop the rebase')!
      .trigger('click')
    expect(model.abortStopped).toHaveBeenCalledWith('rebase')
    view.unmount()
  })
  it('says a stopped rebase quietly, with a warning glyph, and goes on only once nothing is in conflict', async () => {
    const { model, view } = gitModel(false, {
      stopped: { kind: 'rebase', onto: 'main', conflicts: 2 },
    })
    const line = view.get('.abele-node-sidebar__stopped')
    expect(line.find('.abele-obsidian-icon').exists()).toBe(true)
    const button = (text: string) => line.findAll('button').find((b) => b.text() === text)!
    expect(button('Stop the rebase').classes()).toContain('abele-obsidian-button_quiet')
    expect(button('Continue').attributes('disabled')).toBeDefined()
    expect(button('Continue').attributes('aria-label')).toBe('Stage the 2 files in conflict first')
    view.unmount()
    const resolved = gitModel(false, { stopped: { kind: 'rebase', onto: 'main', conflicts: 0 } })
    const go = resolved.view
      .get('.abele-node-sidebar__stopped')
      .findAll('button')
      .find((b) => b.text() === 'Continue')!
    expect(go.attributes('disabled')).toBeUndefined()
    await go.trigger('click')
    expect(resolved.model.continueStopped).toHaveBeenCalledWith('rebase')
    expect(model.continueStopped).not.toHaveBeenCalled()
    resolved.view.unmount()
  })
})
describe('unknown history divergence', () => {
  it('does not turn unavailable ahead and behind counts into zero', () => {
    const view = mount(HistoryView, {
      props: {
        commits: [],
        copy: { id: 'tree', kind: 'worktree', branch: 'topic', path: '/sample/topic', changed: 0 },
      },
    })
    expect(view.find('.abele-history__drift').text()).toContain('?')
    expect(view.find('.abele-history__drift').text()).not.toContain('0')
    view.unmount()
  })
})
describe('pairing endpoint form', () => {
  it('keeps the pin read-only and emits the entered endpoint, rejects non-integral ports', async () => {
    const view = mount(PairDialog, {
      props: { step: 'paste', parse, device: 'Sample device', initial: 'sample code' },
    })
    expect(view.findAll('.setting-item').map((r) => r.find('.setting-item-name').text())).toEqual([
      'Address',
      'Port',
    ])
    await view.find('input[aria-label="Address"]').setValue('alternate.ts.net')
    await view.find('input[aria-label="Port"]').setValue('1e2')
    expect(view.find('button.mod-cta').attributes('disabled')).toBeDefined()
    await view.find('input[aria-label="Port"]').setValue('8443')
    await view.find('button.mod-cta').trigger('click')
    expect(view.emitted('connect')?.[0]).toEqual([
      'sample code',
      { host: 'alternate.ts.net', port: 8443 },
    ])
    expect(view.find('.abele-pair__fields input').exists()).toBe(false)
    view.unmount()
  })
  it('does not carry key-change confirmation into a different pasted code', async () => {
    const view = mount(PairDialog, {
      props: {
        step: 'paste',
        parse: vi.fn(parse),
        device: 'Sample device',
        initial: 'first code',
        keyChanged: true,
      },
    })
    await view.find('.checkbox-container').trigger('click')
    expect(view.find('button.mod-cta').attributes('disabled')).toBeUndefined()
    await view.find('textarea').setValue('second code')
    await flushPromises()
    expect(view.find('button.mod-cta').attributes('disabled')).toBeDefined()
    view.unmount()
  })
})
