import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import FileView from '@/components/nodeWork/FileView.vue'
import GithubBlob from '@/components/github/GithubBlob.vue'
import { FILE_NAVIGATION } from '@/node/fileNavigation'
import GithubCode from '@/components/github/GithubCode.vue'
import { navFor } from '@/github/search/navAddon'
import type { RepositorySource } from '@/repository/source'
import GithubCodeSearch from '@/components/github/GithubCodeSearch.vue'
import { NodeRepositorySource } from '@/repository/node'
import NodePathEditorPane from '@/components/nodeWork/NodePathEditorPane.vue'
import NodePathFilePane from '@/components/nodeWork/NodePathFilePane.vue'
import { h, ref, shallowRef } from 'vue'
import { ChannelError } from '@abele/channel-protocol'
import { useVault } from '../helpers/testEnv'
import { nodeRepositoryLink } from '@/repository/nodeLinks'
import { openNodeRepositoryTarget } from '@/node/openRepository'
import { mountCode } from '@/github/codeViewer'
import { openNodeFileDestination } from '@/node/nodePathNavigation'
vi.mock('@/node/nodePathNavigation', async (original) => ({
  ...(await original<typeof import('@/node/nodePathNavigation')>()),
  openNodeFileDestination: vi.fn(async () => {}),
}))
vi.mock('@/node/openRepository', () => ({ openNodeRepositoryTarget: vi.fn(async () => {}) }))
vi.mock('@/github/codeViewer', () => ({
  mountCode: vi.fn(() => ({ destroy: vi.fn(), blame: vi.fn() })),
}))
const views: ReturnType<typeof mount>[] = []
it('bounds linked ranges to the current document before expanding line decorations', async () => {
  useVault([])
  const view = mount(FileView, {
    props: {
      path: 'sample.ts',
      text: 'first\nsecond',
      mode: 'file',
      line: 1,
      endLine: Number.MAX_SAFE_INTEGER,
    },
  })
  views.push(view)
  await flushPromises()
  expect(vi.mocked(mountCode).mock.calls.at(-1)?.[3]).toEqual({ start: 1, end: 2 })
})
afterEach(() => {
  views.splice(0).forEach((v) => v.unmount())
})
function setup(blame = vi.fn().mockResolvedValue([])) {
  const source = {
    identity: {
      provider: 'node',
      installation: 'sample',
      node: 'node',
      project: 'project',
      workspace: 'tree',
    },
    cacheNamespace: 'sample',
    blame,
    resolve: vi.fn(async (ref: string) => ref),
    navigation: { file: vi.fn(), commit: vi.fn() },
    assertCurrent: vi.fn(),
  } as unknown as RepositorySource
  const view = mount(FileView, {
    props: {
      path: 'sample.ts',
      text: 'const sample = 1',
      mode: 'file',
      repository: source,
      revision: 'working-sample',
    } as never,
  })
  views.push(view)
  return { view, source }
}
describe('node file repository tools', () => {
  it('reveals a navigation destination inside the edited draft', async () => {
    const view = mount(NodePathEditorPane, {
      props: {
        model: {
          document: shallowRef({ text: 'first\nsecond\n' }),
          filePath: ref('sample.ts'),
          draftText: ref('first\nchanged\n'),
          editing: ref(true),
          saving: ref(false),
          draft: shallowRef(null),
        } as never,
        line: 2,
      },
      global: { stubs: { NodeFileSaveState: true } },
    })
    views.push(view)
    expect(view.getComponent(GithubCode).props('range')).toEqual({ start: 2, end: 2 })
  })
  it('releases the plain viewer when a mapped surface attaches and restores it when detached', async () => {
    const mapped = ref(false)
    const view = mount({
      render: () =>
        h(
          FileView,
          { path: 'sample.ts', text: 'const sample = 1', mode: 'file' },
          mapped.value ? { code: () => h('div', 'Mapped source') } : {}
        ),
    })
    views.push(view)
    await flushPromises()
    const plain = vi.mocked(mountCode).mock.results.at(-1)!.value
    const before = vi.mocked(mountCode).mock.calls.length
    mapped.value = true
    await flushPromises()
    expect(plain.destroy).toHaveBeenCalledOnce()
    mapped.value = false
    await flushPromises()
    expect(mountCode).toHaveBeenCalledTimes(before + 1)
  })
  it('retains search and blame controls when a debugger mapping supplies the code surface', async () => {
    const { source } = setup()
    const view = mount(NodePathFilePane, {
      attachTo: document.body,
      props: {
        model: {
          target: {
            nodeId: 'sample-node',
            registrationId: 'node',
            projectId: 'project',
            kind: 'worktree',
            id: 'tree',
          },
          busy: ref(false),
          error: ref(''),
          mode: ref('file'),
          document: shallowRef({ path: 'sample.ts', text: 'const sample = 1' }),
        } as never,
        repository: source,
        revision: 'working-sample',
        debug: {
          registrationId: 'node',
          conversationId: 'sample-chat',
          sourceId: 'sample-source',
          debugSessionId: 'sample-session',
          incarnation: 'sample-incarnation',
          path: 'sample.ts',
          text: 'const sample = 1',
        },
      },
      global: {
        stubs: {
          NodePathDebugFile: {
            props: ['context'],
            template: '<div class="sample-debug-surface">const sample = 1</div>',
          },
        },
      },
    })
    views.push(view)
    await flushPromises()
    expect(view.find('[data-node-find]').exists()).toBe(true)
    expect(navFor(view.get('.abele-file-view').element)).toBeDefined()
    await view.get('[data-node-find]').trigger('click')
    expect(view.find('[role=search]').exists()).toBe(true)
    await view.get('[aria-label="Toggle line blame"]').trigger('click')
    await flushPromises()
    expect(view.get('[aria-label="Toggle line blame"]').attributes('aria-pressed')).toBe('true')
    expect(view.get('.sample-debug-surface').isVisible()).toBe(false)
    await view.get('[aria-label="Toggle line blame"]').trigger('click')
    expect(view.get('.sample-debug-surface').isVisible()).toBe(true)
  })
  it('rereads an expired working file once and then blames it at the fresh revision', async () => {
    const blame = vi
      .fn()
      .mockRejectedValueOnce(new ChannelError('stale_revision'))
      .mockResolvedValue([])
    const { view } = setup(blame)
    const refresh = vi.fn(async () => {
      await view.setProps({ revision: 'working-fresh' } as never)
    })
    await view.setProps({ refresh } as never)
    await flushPromises()
    await view.get('[aria-label="Toggle line blame"]').trigger('click')
    await flushPromises()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(blame).toHaveBeenLastCalledWith('working-fresh', 'sample.ts')
    expect(view.find('[role=alert]').exists()).toBe(false)
  })
  it('routes rendered working-file links through the ordinary file navigation binding', async () => {
    const { source } = setup()
    const navigate = vi.fn(() => true)
    const view = mount(FileView, {
      props: {
        path: 'sample.ts',
        text: 'const sample = 1',
        mode: 'file',
        repository: source,
        revision: 'working-sample',
      },
      global: { provide: { [FILE_NAVIGATION as symbol]: navigate } },
    })
    views.push(view)
    const url = nodeRepositoryLink(source.identity, {
      kind: 'file',
      ref: 'working-sample',
      path: 'sample.ts',
      lines: { from: 1, to: 1 },
    })
    view.getComponent(GithubBlob).vm.$emit('open', url)
    await flushPromises()
    expect(navigate).toHaveBeenCalledWith(url)
  })
  it('opens a working definition in the same file surface at the destination line', async () => {
    useVault([])
    const { source } = setup()
    source.navigation.file = (ref, path, line) =>
      nodeRepositoryLink(source.identity, {
        kind: 'file',
        ref,
        path,
        lines: { from: line!, to: line! },
      })
    const target = {
      nodeId: 'sample-node',
      registrationId: 'node',
      projectId: 'project',
      kind: 'worktree',
      id: 'tree',
    }
    const view = mount(NodePathFilePane, {
      props: {
        model: {
          target,
          busy: ref(false),
          error: ref(''),
          mode: ref('file'),
          document: shallowRef({ path: 'sample.ts', text: 'const sample = 1' }),
        } as never,
        repository: source,
        revision: 'working-sample',
      },
    })
    views.push(view)
    await flushPromises()
    await navFor(view.get('.abele-file-view').element)!.goToDefinition('sample', 'sample.ts')
    expect(openNodeFileDestination).toHaveBeenCalledWith(
      expect.anything(),
      { kind: 'file', target, path: 'sample.ts', line: 1 },
      expect.any(Boolean)
    )
  })
  it('destroys the plain viewer when repository tools arrive for unchanged text', async () => {
    const { source } = setup()
    const view = mount(FileView, {
      props: { path: 'sample.ts', text: 'const sample = 1', mode: 'file' },
    })
    views.push(view)
    await flushPromises()
    const plain = vi.mocked(mountCode).mock.results.at(-1)!.value
    await view.setProps({ repository: source, revision: 'working-sample' })
    await flushPromises()
    expect(plain.destroy).toHaveBeenCalledOnce()
  })
  it('wires the ordinary file pane through to the tools and releases navigation on close', async () => {
    const { source } = setup()
    const view = mount(NodePathFilePane, {
      props: {
        model: {
          busy: ref(false),
          error: ref(''),
          mode: ref('file'),
          document: shallowRef({ path: 'sample.ts', text: 'const sample = 1' }),
        } as never,
        repository: source,
        revision: 'working-sample',
      },
    })
    views.push(view)
    await flushPromises()
    const root = view.get('.abele-file-view').element
    expect(navFor(root)?.pathOf(root)).toBe('sample.ts')
    view.unmount()
    views.pop()
    expect(navFor(root)).toBeNull()
  })

  it('keeps find and navigation on an edited draft without attributing unsaved lines', async () => {
    const { source } = setup()
    const view = mount(NodePathEditorPane, {
      props: {
        model: {
          document: shallowRef({ text: 'const sample = 1' }),
          filePath: ref('sample.ts'),
          draftText: ref('const sample = 2'),
          editing: ref(true),
          saving: ref(false),
          draft: shallowRef(null),
        } as never,
        repository: source,
        revision: 'working-sample',
      },
      global: { stubs: { NodeFileSaveState: true } },
    })
    views.push(view)
    await flushPromises()
    expect(navFor(view.element)?.pathOf(view.element)).toBe('sample.ts')
    await view.get('[data-node-find]').trigger('click')
    expect(view.find('[role="search"]').exists()).toBe(true)
    expect(view.find('[aria-label="Toggle line blame"]').exists()).toBe(false)
    expect(view.getComponent(GithubCode).props('editable')).toBe(true)
  })

  it('resolves a definition using the file on screen and opens its retained revision', async () => {
    useVault([])
    const { view, source } = setup()
    source.navigation.file = vi.fn((ref, path, line) =>
      nodeRepositoryLink(source.identity, {
        kind: 'file',
        ref,
        path,
        lines: { from: line!, to: line! },
      })
    )
    await flushPromises()
    await navFor(view.element)!.goToDefinition('sample', 'sample.ts')
    expect(source.navigation.file).toHaveBeenCalledWith('working-sample', 'sample.ts', 1)
    expect(openNodeRepositoryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        location: expect.objectContaining({
          kind: 'file',
          ref: 'working-sample',
          path: 'sample.ts',
        }),
      }),
      false
    )
  })
  it('offers find when a changed file first opens in comparison mode', async () => {
    const mode = ref<'diff' | 'file'>('diff')
    const view = mount(NodePathFilePane, {
      props: {
        model: {
          busy: ref(false),
          error: ref(''),
          mode,
          document: shallowRef({
            path: 'sample.ts',
            text: 'const sample = 2',
            change: {
              kind: 'modified',
              before: 'const sample = 1',
              after: 'const sample = 2',
            },
          }),
        } as never,
      },
    })
    views.push(view)
    await flushPromises()
    await view.get('[data-node-find]').trigger('click')
    expect(mode.value).toBe('file')
    expect(view.find('[role=search]').exists()).toBe(true)
  })

  it('keeps in-file find available without a git revision, including its keyboard shortcut', async () => {
    const view = mount(FileView, {
      props: { path: 'sample.txt', text: 'Sample text', mode: 'file' },
    })
    views.push(view)
    await flushPromises()
    await view.trigger('keydown', { key: 'f', ctrlKey: true })
    expect(view.find('[role="search"]').exists()).toBe(true)
    expect(view.find('[aria-label="Toggle line blame"]').exists()).toBe(false)
  })

  it('opens references with the repository search panel and searches at the displayed revision', async () => {
    const { view, source } = setup()
    source.search = vi.fn(async () => ({ files: [], total: 0, capped: false }))
    await flushPromises()
    navFor(view.element)!.findReferences('sample')
    await flushPromises()
    const panel = view.getComponent(GithubCodeSearch)
    expect(panel.get('input').element.value).toBe('sample')
    await panel.props('code').search('repo', { text: 'sample' }, '')
    expect(source.search).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'working-sample', scope: 'repo', query: { text: 'sample' } })
    )
  })

  it('does not replace a code navigation context menu with the file menu', async () => {
    const { view } = setup()
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    event.preventDefault()
    view.element.dispatchEvent(event)
    expect(view.emitted('menu')).toBeUndefined()
  })

  it('shows loading and retry after a blame error, then clears blame for another file', async () => {
    let reject!: (error: Error) => void
    const blame = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail
          })
      )
      .mockResolvedValue([])
    const { view } = setup(blame)
    await flushPromises()
    await view.get('[aria-label="Toggle line blame"]').trigger('click')
    expect(view.text()).toContain('Loading line blame')
    reject(new Error('Sample blame unavailable'))
    await flushPromises()
    expect(view.text()).toContain('Sample blame unavailable')
    await view.get('.abele-github-notice button').trigger('click')
    await flushPromises()
    expect(blame).toHaveBeenCalledTimes(2)
    await view.setProps({ path: 'other.ts' })
    expect(view.get('[aria-label="Toggle line blame"]').attributes('aria-pressed')).toBe('false')
    expect(view.getComponent(GithubCode).props('blame')).toBeNull()
  })

  it('uses the node blame transport with the retained working observation and uncommitted ranges', async () => {
    const revision = {
      kind: 'working' as const,
      head: 'a'.repeat(40),
      observation_id: 'sample-observation',
      observed_at: '2026-01-01T00:00:00Z',
    }
    const blame = vi.fn(async () => ({
      entries: [{ line: 1, commit: null, author: '' }],
      cursor: null,
      incomplete: false,
      omissions: [],
    }))
    const source = new NodeRepositorySource(
      { repository: { blame } } as never,
      {
        provider: 'node',
        installation: 'sample',
        node: 'node',
        project: 'project',
        workspace: 'tree',
      },
      { node: '', project: '' },
      {
        kind: 'working-tree',
        head: revision.head,
        observation: revision.observation_id,
        observedAt: revision.observed_at,
      }
    )
    const { view } = setup()
    await view.setProps({ repository: source, revision: 'working-sample-observation' })
    await flushPromises()
    await view.get('[aria-label="Toggle line blame"]').trigger('click')
    await flushPromises()
    expect(blame).toHaveBeenCalledWith(
      expect.objectContaining({ worktree_id: 'tree', revision, path: 'sample.ts' })
    )
    expect(view.getComponent(GithubCode).props('blame')).toMatchObject([
      { start: 1, end: 1, commit: { sha: '', author: 'Uncommitted' } },
    ])
    source.dispose()
  })
  it('offers the repository find bar and registers navigation for the file', async () => {
    const { view } = setup()
    await flushPromises()
    expect(navFor(view.element)?.pathOf(view.element)).toBe('sample.ts')
    await view.get('[aria-label="Find in this tab (Mod+F)"]').trigger('click')
    expect(view.find('[role="search"]').exists()).toBe(true)
  })
  it('requests blame at the shown revision and passes ranges to the shared code gutter', async () => {
    const ranges = [
      {
        start: 1,
        end: 1,
        commit: {
          sha: 'a'.repeat(40),
          author: 'Example',
          message: 'Sample change',
          date: '2026-01-01',
        },
      },
    ]
    const blame = vi.fn().mockResolvedValue(ranges)
    const { view } = setup(blame)
    await flushPromises()
    expect(blame).not.toHaveBeenCalled()
    await view.get('[aria-label="Toggle line blame"]').trigger('click')
    await flushPromises()
    expect(blame).toHaveBeenCalledWith('working-sample', 'sample.ts')
    expect(view.getComponent(GithubCode).props('blame')).toEqual(ranges)
  })
})
