import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { computed } from 'vue'
import { MarkdownRenderer } from 'obsidian'
import GithubMarkdown from '@/components/github/GithubMarkdown.vue'
import FileView from '@/components/nodeWork/FileView.vue'
import { NodeRepositorySource } from '@/repository/node'
import { REPOSITORY_SOURCE } from '@/repository/context'
import { nodeRepositoryFixture, identity, HEAD } from '../helpers/nodeRepositoryFixture'
import { useVault } from '../helpers/testEnv'
import { NodePathTabSchema } from '@/node/nodePathNavigation'
import { FILE_NAVIGATION } from '@/node/fileNavigation'

enableAutoUnmount(afterEach)
beforeEach(() => useVault([]))
afterEach(() => vi.restoreAllMocks())
const file = { host: 'node.invalid', owner: '', repo: '', ref: HEAD, path: 'docs/guide.md' }
function source() {
  const fixture = nodeRepositoryFixture()
  return new NodeRepositorySource(fixture.client, identity, { node: 'Sample', project: 'Project' })
}
it('reads a validated raster through the workspace repository content API', async () => {
  const fixture = nodeRepositoryFixture()
  const repo = new NodeRepositorySource(fixture.client, identity, {
    node: 'Sample',
    project: 'Project',
  })
  vi.spyOn(fixture.client.repository, 'blob').mockResolvedValue({
    content_id: 'a'.repeat(64),
    size: 8,
    binary: true,
    too_large: false,
    requires_larger_load: false,
  })
  const read = vi
    .spyOn(fixture.client.repository, 'content')
    .mockResolvedValue({ offset: 0, total: 8, base64: 'iVBORw0KGgo=' })
  const image = await repo.image(HEAD, 'images/sample.png')
  expect(image.type).toBe('image/png')
  expect(image.size).toBe(8)
  expect(read.mock.calls[0][0]).toMatchObject({
    worktree_id: identity.workspace,
    content_id: 'a'.repeat(64),
  })
  repo.dispose()
})
it('shows loading, a missing image fallback, and wraps only long table cells', async () => {
  const repo = source()
  let reject!: (reason: Error) => void
  repo.image = vi.fn(
    () =>
      new Promise((_resolve, no) => {
        reject = no
      })
  )
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _text, el) => {
    el.innerHTML =
      '<p><img src="sample.png" alt="Sample picture"></p><table><tr><td>short</td><td></td></tr></table>'
    el.querySelector('td:last-child')!.textContent = 'Long text '.repeat(8)
  })
  const view = mount(GithubMarkdown, {
    props: { text: 'paragraph', file },
    global: { provide: { [REPOSITORY_SOURCE as symbol]: computed(() => repo) } },
  })
  await flushPromises()
  expect(repo.image).toHaveBeenCalledWith(HEAD, 'docs/sample.png')
  expect(view.find('.abele-github-md__image_loading').exists()).toBe(true)
  expect(view.findAll('.abele-github-md__table')).toHaveLength(1)
  expect(view.findAll('.abele-github-md__cell-text')).toHaveLength(1)
  reject(new Error('missing'))
  await flushPromises()
  expect(view.find('img').exists()).toBe(false)
  expect(view.find('.abele-github-md__missing').text()).toBe('Sample picture')
  await view.setProps({ file: { ...file, path: 'other/guide.md' } })
  await flushPromises()
  expect(repo.image).toHaveBeenLastCalledWith(HEAD, 'other/sample.png')
  reject(new Error('missing'))
  await flushPromises()
  repo.dispose()
})
it('releases node image URLs and ignores image reads that finish after closing', async () => {
  const repo = source()
  let finish!: (blob: Blob) => void
  repo.image = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sample')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _text, el) => {
    el.innerHTML = '<img src="sample.png" alt="Sample">'
  })
  const options = {
    props: { text: 'paragraph', file },
    global: { provide: { [REPOSITORY_SOURCE as symbol]: computed(() => repo) } },
  }
  const view = mount(GithubMarkdown, options)
  await flushPromises()
  finish(new Blob(['sample'], { type: 'image/png' }))
  await flushPromises()
  expect(view.find('img').attributes('src')).toBe('blob:sample')
  view.unmount()
  expect(revoke).toHaveBeenCalledWith('blob:sample')
  const late = mount(GithubMarkdown, options)
  await flushPromises()
  late.unmount()
  finish(new Blob(['sample']))
  await flushPromises()
  expect(create).toHaveBeenCalledTimes(1)
  repo.dispose()
})
it('renders node markdown by default and keeps the toggle choice after refresh', async () => {
  const repo = source()
  const view = mount(FileView, {
    props: { text: '# Sample', path: 'README.md', mode: 'file', repository: repo, revision: HEAD },
  })
  await flushPromises()
  expect(view.find('.abele-github-md').exists()).toBe(true)
  const button = () => view.find('.abele-file-view__header [aria-label="Preview"]')
  await button().trigger('click')
  await flushPromises()
  expect(view.find('.cm-editor').exists()).toBe(true)
  await view.setProps({ text: '# Updated' })
  expect(view.find('.abele-github-md').exists()).toBe(false)
  await button().trigger('click')
  await flushPromises()
  expect(view.find('.abele-github-md').exists()).toBe(true)
  repo.dispose()
})
it('shows an empty markdown file without claiming it contains one line', async () => {
  const repo = source()
  const view = mount(FileView, {
    props: { text: '', path: 'empty.md', mode: 'file', repository: repo, revision: HEAD },
  })
  await flushPromises()
  expect(view.find('.abele-file-view__size').text()).toBe('Empty')
  expect(view.text()).toContain('This file is empty.')
  repo.dispose()
})
it('routes relative links through node navigation, keeps anchors local and web links external', async () => {
  const repo = source()
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _text, el) => {
    el.innerHTML =
      '<a href="other.md">File</a><a href="#sample">Anchor</a><a href="https://example.test/guide">Web</a>'
  })
  const navigate = vi.fn(() => true)
  const view = mount(FileView, {
    props: {
      text: '# Sample',
      path: 'docs/guide.md',
      mode: 'file',
      repository: repo,
      revision: HEAD,
    },
    global: { provide: { [FILE_NAVIGATION as symbol]: navigate } },
  })
  await flushPromises()
  const links = view.findAll('.abele-github-md__content a')
  await links[0].trigger('click')
  expect(navigate).toHaveBeenCalledWith(repo.navigation.file(HEAD, 'docs/other.md'))
  await links[1].trigger('click')
  expect(navigate).toHaveBeenCalledTimes(1)
  expect(links[2].attributes('href')).toBe('https://example.test/guide')
  repo.dispose()
})
it('retains the explicit markdown mode in a saved file tab', () => {
  const state = NodePathTabSchema.parse({
    kind: 'file',
    target: {
      nodeId: 'sample-node',
      registrationId: 'sample-registration',
      projectId: 'sample-project',
      kind: 'worktree',
      id: 'sample-tree',
    },
    path: 'README.md',
    markdownMode: 'code',
  })
  expect(state).toHaveProperty('markdownMode', 'code')
})
it('keeps non-markdown node files as code and blame forces markdown to code', async () => {
  const repo = source()
  const view = mount(FileView, {
    props: {
      text: 'export const sample = 1',
      path: 'sample.ts',
      mode: 'file',
      repository: repo,
      revision: HEAD,
      markdownMode: 'preview',
    },
  })
  await flushPromises()
  expect(view.find('.cm-editor').exists()).toBe(true)
  expect(view.find('[aria-label="Preview"]').exists()).toBe(false)
  await view.setProps({ path: 'README.md', text: '# Sample' })
  await flushPromises()
  const blame = view
    .findAll('.abele-file-view__header .abele-obsidian-icon')
    .find((icon) => icon.attributes('aria-label')?.includes('blame'))!
  await blame.trigger('click')
  await flushPromises()
  expect(view.find('.abele-github-md').exists()).toBe(false)
  expect(view.find('.cm-editor').exists()).toBe(true)
  repo.dispose()
})
