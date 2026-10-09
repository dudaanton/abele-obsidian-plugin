import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import GithubTreePanel from '@/components/github/GithubTreePanel.vue'
import GithubItem from '@/components/github/GithubItem.vue'
import GithubFolder from '@/components/github/GithubFolder.vue'
import GithubBlob from '@/components/github/GithubBlob.vue'
import GithubCompare from '@/components/github/GithubCompare.vue'
import GithubCodeSearch from '@/components/github/GithubCodeSearch.vue'
import GithubFindBar from '@/components/github/GithubFindBar.vue'
import GithubRepoHome from '@/components/github/GithubRepoHome.vue'
import GithubPinnedFile from '@/components/github/GithubPinnedFile.vue'
import { REPOSITORY_SOURCE } from '@/repository/context'
import { InMemoryRepository } from '../helpers/inMemoryRepository'
import { useVault } from '../helpers/testEnv'
import { emptyScreen } from '@/github/screen'
import type { GithubViewModel } from '@/github/model'
import { basePins } from '@/github/comparison/pins'

const repo = { host: 'local.invalid', owner: 'local', repo: 'project' }
const BASE = 'a'.repeat(40),
  HEAD = 'b'.repeat(40)
const globalFor = (source: InMemoryRepository) => ({
  provide: { [REPOSITORY_SOURCE as symbol]: computed(() => source) },
})
beforeEach(() => useVault([]))

describe('shared repository components with an in-memory source', () => {
  it('loads the whole repository tab, its tree and source breadcrumbs without a client', async () => {
    const source = new InMemoryRepository(HEAD, { 'src/app.ts': 'export const value = 42\n' })
    const model: GithubViewModel = reactive({
      url: '',
      target: { ...repo, kind: 'blob', rest: ['main', 'src', 'app.ts'] },
      nonce: 0,
      tree: true,
      screen: emptyScreen(),
    })
    const wrapper = mount(GithubItem, {
      props: {
        model,
        enabled: true,
        source,
        sourceLocation: { kind: 'file', ref: 'main', path: 'src/app.ts' },
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('export const value = 42')
    expect(wrapper.find('.tree-item-self[data-path="src/app.ts"]').exists()).toBe(true)
    expect(
      wrapper.findAll('.abele-github-crumbs__link').map((link) => link.attributes('href'))
    ).toEqual(['memory:tree/main/', 'memory:tree/main/src'])
    expect(model.screen.link?.url).toBe('memory:blob/main/src/app.ts')
    wrapper.unmount()
  })
  it('uses a local frozen base in the full tab without GitHub comparison requests', async () => {
    const app = useVault([]),
      source = new InMemoryRepository(HEAD, { 'app.ts': 'new line\n' })
    source.revisions.set(BASE, { 'app.ts': 'old line\n' })
    const pins = basePins(app)
    pins.save(await pins.resolveSource(source, repo, BASE))
    const model: GithubViewModel = reactive({
      url: '',
      target: { ...repo, kind: 'blob', rest: ['main', 'app.ts'] },
      nonce: 0,
      tree: false,
      screen: emptyScreen(),
    })
    const onOpen = vi.fn()
    const wrapper = mount(GithubItem, {
      props: {
        model,
        enabled: true,
        source,
        onOpen,
        sourceLocation: { kind: 'file', ref: 'main', path: 'app.ts' },
      },
    })
    await flushPromises()
    expect(wrapper.find('.abele-github-pinned').exists()).toBe(true)
    expect(wrapper.text()).toContain('old line')
    expect(wrapper.text()).toContain('new line')
    expect(model.screen.comparison).toMatchObject({ baseSha: BASE, targetSha: HEAD })
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Open base')!
      .trigger('click')
    expect(onOpen).toHaveBeenCalledWith(`memory:blob/${BASE}/app.ts`, false)
    wrapper.unmount()
  })
  it('reloads when opaque workspace identity changes despite identical display labels and authority', async () => {
    const first = new InMemoryRepository(HEAD, { 'app.ts': 'first workspace' })
    const second = new InMemoryRepository(HEAD, { 'app.ts': 'second workspace' })
    second.identity.workspace = 'workspace-2'
    const model: GithubViewModel = reactive({
      url: '',
      target: { ...repo, kind: 'blob', rest: ['main', 'app.ts'] },
      nonce: 0,
      tree: false,
      screen: emptyScreen(),
    })
    const wrapper = mount(GithubItem, {
      props: {
        model,
        enabled: true,
        source: first,
        sourceLocation: { kind: 'file', ref: 'main', path: 'app.ts' },
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('first workspace')
    await wrapper.setProps({ source: second })
    await flushPromises()
    expect(wrapper.text()).toContain('second workspace')
    expect(wrapper.text()).not.toContain('first workspace')
    wrapper.unmount()
  })
  it('browses and filters a tree and emits source links without a GitHub client', async () => {
    const source = new InMemoryRepository(HEAD, {
      'src/app.ts': 'export const answer = 42\n',
      'docs/guide.txt': 'Guide',
    })
    const tree = vi.spyOn(source, 'tree')
    const wrapper = mount(GithubTreePanel, {
      props: {
        repo,
        versionKey: HEAD,
        resolve: async () => ({ ref: 'main', sha: HEAD }),
        current: { path: 'src/app.ts', kind: 'file' },
      },
      global: globalFor(source),
    })
    await flushPromises()
    expect(tree).toHaveBeenCalledWith(HEAD)
    const row = wrapper.find('.tree-item-self[data-path="src/app.ts"]')
    expect(row.exists()).toBe(true)
    await row.trigger('click')
    expect(wrapper.emitted('open')?.[0]?.[0]).toBe('memory:blob/main/src/app.ts')
    await wrapper.find('input').setValue('guide')
    expect(wrapper.text()).toContain('guide.txt')
    expect(wrapper.text()).not.toContain('app.ts')
    wrapper.unmount()
  })
  it('reads a folder README and navigates to files through the source', async () => {
    const source = new InMemoryRepository(HEAD, {
      'README.txt': 'Local project README',
      'app.ts': 'const value = 1',
    })
    const read = vi.spyOn(source, 'text')
    const wrapper = mount(GithubFolder, {
      props: { repo, folder: await source.folder('main', '') },
      global: globalFor(source),
    })
    await flushPromises()
    expect(read).toHaveBeenCalledWith('main', 'README.txt', 'the README')
    expect(wrapper.text()).toContain('Local project README')
    await wrapper.find('.tree-item-self[data-path="app.ts"]').trigger('click')
    expect(wrapper.emitted('open')?.[0]?.[0]).toBe('memory:blob/main/app.ts')
    wrapper.unmount()
  })
  it('loads blame and opens a local commit without GitHub profile lookups', async () => {
    const source = new InMemoryRepository(HEAD, { 'app.ts': 'const value = 1\n' })
    source.blameRanges.set('app.ts', [
      {
        start: 1,
        end: 1,
        commit: {
          sha: HEAD,
          message: 'Add value',
          author: 'Local author',
          date: '2026-10-09T10:00:00Z',
        },
      },
    ])
    const blame = vi.spyOn(source, 'blame')
    const wrapper = mount(GithubBlob, {
      props: {
        text: await source.text('main', 'app.ts'),
        file: { ...repo, ref: 'main', path: 'app.ts' },
      },
      global: globalFor(source),
    })
    await wrapper.find('[aria-label="Toggle line blame"]').trigger('click')
    await flushPromises()
    expect(blame).toHaveBeenCalledWith('main', 'app.ts')
    expect(wrapper.text()).toContain('Local author')
    await wrapper.find('.abele-github-blame-range__open').trigger('click')
    expect(wrapper.emitted('open')?.[0]?.[0]).toBe(`memory:commit/${HEAD}`)
    wrapper.unmount()
  })
  it('renders endpoint diffs and preserves selected-side source links', async () => {
    const source = new InMemoryRepository(HEAD, { 'app.ts': 'new line\n' })
    source.revisions.set(BASE, { 'app.ts': 'old line\n' })
    const index = await source.comparison(BASE, HEAD)
    const wrapper = mount(GithubPinnedFile, {
      props: { repo, file: await source.comparisonFile(index, 'app.ts'), nonce: 1 },
      global: globalFor(source),
    })
    await flushPromises()
    expect(wrapper.text()).toContain('old line')
    expect(wrapper.text()).toContain('new line')
    expect(index.counts.get('app.ts')).toMatchObject({ additions: 1, deletions: 1 })
    const buttons = wrapper.findAll('button')
    await buttons.find((button) => button.text() === 'Open base')!.trigger('click')
    await buttons.find((button) => button.text() === 'Open target')!.trigger('click')
    expect(wrapper.emitted('open')).toEqual([
      [`memory:blob/${BASE}/app.ts`],
      [`memory:blob/${HEAD}/app.ts`],
    ])
    wrapper.unmount()
  })
  it('opens comparison commits through source navigation', async () => {
    const source = new InMemoryRepository(HEAD, { 'app.ts': 'after' })
    source.revisions.set(BASE, { 'app.ts': 'before' })
    const data = {
      ...(await source.compare(BASE, HEAD)),
      totalCommits: 1,
      commits: [await source.commit(HEAD)],
    }
    const wrapper = mount(GithubCompare, {
      props: { repo, data, tab: 'commits' },
      global: globalFor(source),
    })
    await wrapper.find('.abele-github-commits .abele-card').trigger('click')
    expect(wrapper.emitted('open')?.[0]?.[0]).toBe(`memory:commit/${HEAD}`)
    wrapper.unmount()
  })
  it('searches source content and follows results through the existing search panel', async () => {
    const source = new InMemoryRepository(HEAD, { 'app.ts': 'const answer = 42\n' })
    const wrapper = mount(GithubCodeSearch, {
      props: {
        code: {
          refLabel: () => 'main',
          search: (scope, query, glob, onStage, signal) =>
            source.search({ ref: HEAD, scope, query, glob, onStage, signal, limitBytes: 1024 }),
        },
      },
    })
    await wrapper.find('input').setValue('answer')
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.text()).toContain('const answer = 42')
    await wrapper.find('.abele-github-search__path').trigger('click')
    expect(wrapper.emitted('open')?.[0]?.[0]).toBe(`memory:blob/${HEAD}/app.ts`)
    wrapper.unmount()
  })
  it('finds local rendered content with the existing find bar', async () => {
    const root = document.createElement('div')
    root.textContent = 'Local answer. Another answer.'
    document.body.append(root)
    const wrapper = mount(GithubFindBar, { props: { root, hooks: { foldedText: () => null } } })
    await wrapper.find('input').setValue('answer')
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.text()).toContain('of 2')
    wrapper.unmount()
    root.remove()
  })
  it('shows a local repository home without inventing GitHub-only sections', async () => {
    const source = new InMemoryRepository(HEAD, { 'README.txt': 'Offline repository' })
    const wrapper = mount(GithubRepoHome, {
      props: { repo, home: await source.home() },
      global: globalFor(source),
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Offline repository')
    expect(wrapper.text()).not.toContain('Open pull requests')
    expect(wrapper.text()).not.toContain('Open issues')
    wrapper.unmount()
  })
})
