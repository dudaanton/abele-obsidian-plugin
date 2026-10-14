import { beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import GithubItem from '@/components/github/GithubItem.vue'
import { NodeRepositorySource, WORKING_TREE } from '@/repository/node'
import { nodeRepositoryFixture, identity } from '../helpers/nodeRepositoryFixture'
import { useVault } from '../helpers/testEnv'
import { emptyScreen } from '@/github/screen'
import type { GithubViewModel } from '@/github/model'

const repo = { host: 'node.invalid', owner: 'Sample node', repo: 'Sample project' }
beforeEach(() => useVault([]))

const entry = (path: string, kind: 'file' | 'directory') => ({
  name: path.split('/').pop()!,
  path,
  kind,
  oid: null,
  size: kind === 'file' ? 10 : null,
})

function fixture() {
  const f = nodeRepositoryFixture()
  let rootFiles = [entry('src', 'directory'), entry('app.ts', 'file'), entry('README.md', 'file')]
  let inner = [entry('src/inner.ts', 'file')]
  const tree = vi.spyOn(f.client.repository, 'tree').mockImplementation(async (params) => ({
    entries: params.path === 'src' ? inner : params.path ? [] : rootFiles,
    cursor: null,
    incomplete: false,
    omissions: [],
  }))
  const source = new NodeRepositorySource(f.client, identity, {
    node: repo.owner,
    project: repo.repo,
  })
  const model: GithubViewModel = reactive({
    target: { ...repo, kind: 'repo' as const, ref: WORKING_TREE },
    url: '',
    nonce: 0,
    tree: true,
    screen: emptyScreen(),
  })
  const wrapper = mount(GithubItem, {
    attachTo: document.body,
    props: {
      model,
      enabled: true,
      source,
      sourceLocation: { kind: 'home', ref: WORKING_TREE },
      onOpen: vi.fn(),
    },
  })
  return {
    ...f,
    tree,
    source,
    wrapper,
    setRoot: (next: typeof rootFiles) => (rootFiles = next),
    setInner: (next: typeof inner) => (inner = next),
  }
}
const panelRows = (wrapper: ReturnType<typeof fixture>['wrapper']) =>
  wrapper.findAll('.abele-github-tree .tree-item-self').map((row) => row.attributes('data-path'))

it('keeps open folders, rows and scroll in the file tree across node refreshes', async () => {
  const f = fixture()
  await f.source.startWatching()
  await flushPromises()
  const folder = f.wrapper
    .findAll('.abele-github-tree .tree-item-self')
    .find((row) => row.attributes('data-path') === 'src')!
  await folder.trigger('click')
  await flushPromises()
  expect(panelRows(f.wrapper)).toContain('src/inner.ts')
  const body = f.wrapper.find('.abele-github-tree__body').element as HTMLElement
  body.scrollTop = 40
  const row = f.wrapper.find('.abele-github-tree [data-path="src/inner.ts"]').element

  // Several refresh cycles with nothing changed: nothing visible moves.
  for (let i = 0; i < 3; i++) {
    f.change()
    await flushPromises()
  }
  expect(f.wrapper.find('.abele-github-tree').text()).not.toContain('Loading the files')
  expect(panelRows(f.wrapper)).toContain('src/inner.ts')
  expect(f.wrapper.find('.abele-github-tree [data-path="src/inner.ts"]').element).toBe(row)
  expect(body.scrollTop).toBe(40)
  expect(f.wrapper.find('.abele-github-tree__body').element).toBe(body)

  // A real change shows up in place, the folder still open.
  f.setInner([entry('src/inner.ts', 'file'), entry('src/added.ts', 'file')])
  f.setRoot([entry('src', 'directory'), entry('app.ts', 'file')])
  f.change()
  await flushPromises()
  const rows = panelRows(f.wrapper)
  expect(rows).toContain('src/added.ts')
  expect(rows).toContain('src/inner.ts')
  expect(rows).not.toContain('README.md')
  expect(f.wrapper.find('.abele-github-tree [data-path="src/inner.ts"]').element).toBe(row)
  f.wrapper.unmount()
  f.source.dispose()
})
