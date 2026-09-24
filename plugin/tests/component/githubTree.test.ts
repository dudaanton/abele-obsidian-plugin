/**
 * The way from a line of code to the folders around it: breadcrumbs over a file, the folder a
 * crumb opens — its entries and its README — the folder links in a diff's header, and the file
 * tree panel beside whatever the tab shows, at the version it shows.
 *
 * happy-dom lays nothing out, so the drawer over a phone's content is asserted as what the panel
 * does when it lies over the content; the geometry is the e2e tier's.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { Platform } from 'obsidian'
import { PULL, file, openTab, type Route } from '../helpers/githubTab'
import { useVault } from '../helpers/testEnv'
import { forgetRepoTrees } from '@/github/tree/repoTree'
import { PANEL_KEY } from '@/github/tree/panel'
import { GlobalStore } from '@/stores/GlobalStore'

const HEAD = '1'.repeat(40)
const MAIN = '2'.repeat(40)

const TREE = {
  tree: [
    { path: 'README.md', type: 'blob', size: 40, sha: 'r' },
    { path: 'src', type: 'tree', sha: 's' },
    { path: 'src/app.ts', type: 'blob', size: 300, sha: 'a' },
    { path: 'src/util', type: 'tree', sha: 'u' },
    { path: 'src/util/format.ts', type: 'blob', size: 80, sha: 'f' },
    { path: 'src/util/parse.ts', type: 'blob', size: 90, sha: 'p' },
    { path: 'docs', type: 'tree', sha: 'd' },
    { path: 'docs/guide.md', type: 'blob', size: 10, sha: 'g' },
  ],
  truncated: false,
}

/** The repository at `main` (= MAIN) and at the pull request's head (= HEAD). */
const REPO: Record<string, Route> = {
  '/repos/o/r': { json: { default_branch: 'main' } },
  '/repos/o/r/commits/main': { text: MAIN },
  [`/repos/o/r/git/trees/${MAIN}`]: { json: TREE },
  [`/repos/o/r/git/trees/${HEAD}`]: { json: TREE },
  '/repos/o/r/contents/src/util/format.ts': { text: 'export const format = 1\n' },
  '/repos/o/r/contents/src': {
    json: [
      { name: 'app.ts', path: 'src/app.ts', type: 'file', size: 300 },
      { name: 'util', path: 'src/util', type: 'dir', size: 0 },
      { name: 'README.md', path: 'src/README.md', type: 'file', size: 2048 },
    ],
  },
  '/repos/o/r/contents/src/README.md': { text: '# Source\n\nThe [helpers](util/) live here.' },
}

const PULL_ROUTES: Record<string, Route> = {
  ...REPO,
  '/repos/o/r/pulls/7': { json: { ...PULL, head: { label: 'ann:fix', sha: HEAD } } },
  '/repos/o/r/issues/7/comments': { json: [] },
  '/repos/o/r/pulls/7/reviews': { json: [] },
  '/repos/o/r/pulls/7/comments': { json: [] },
  '/repos/o/r/pulls/7/files': { json: [file('src/util/format.ts')] },
}

const headerIcon = (w: VueWrapper, name: string) =>
  w
    .find(`.abele-github-header__actions [data-icon="${name}"]`)
    .element.closest('.abele-obsidian-icon') as HTMLElement

const click = async (el: Element, init: MouseEventInit = {}) => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
  await flushPromises()
}

const row = (w: VueWrapper, path: string) =>
  w.find(`.abele-github-tree .tree-item-self[data-path="${path}"]`)

beforeEach(() => {
  useVault([])
  forgetRepoTrees()
  document.body.replaceChildren()
  Platform.isPhone = false
})

describe('breadcrumbs over a file', () => {
  it('lead up to the repository, each folder a link at the same ref, with the ref beside', async () => {
    const { wrapper, onOpen } = openTab('https://github.com/o/r/blob/main/src/util/format.ts', REPO)
    await flushPromises()

    const links = wrapper.findAll('.abele-github-crumbs__link')
    expect(links.map((a) => [a.text(), a.attributes('href')])).toEqual([
      ['r', 'https://github.com/o/r/tree/main'],
      ['src', 'https://github.com/o/r/tree/main/src'],
      ['util', 'https://github.com/o/r/tree/main/src/util'],
    ])
    expect(wrapper.find('.abele-github-crumbs__part_current').text()).toBe('format.ts')
    expect(wrapper.find('.abele-github-crumbs__ref').text()).toBe('main')

    await click(links[1].element)
    expect(onOpen).toHaveBeenLastCalledWith('https://github.com/o/r/tree/main/src', false)
    await click(links[2].element, { metaKey: true })
    expect(onOpen).toHaveBeenLastCalledWith('https://github.com/o/r/tree/main/src/util', 'tab')
  })
})

describe('a folder in a tab', () => {
  it('lists its folders, then its files with their sizes, and renders its README', async () => {
    const { wrapper, onOpen, onTitle, model } = openTab(
      'https://github.com/o/r/tree/main/src',
      REPO
    )
    // The README goes through the renderer every piece of GitHub text does (a stub here).
    await vi.waitFor(() =>
      expect(wrapper.find('.abele-github-folder__readme .abele-github-text').text()).toContain(
        'live here'
      )
    )

    const rows = wrapper.findAll('.abele-github-folder .tree-item-self')
    expect(rows.map((r) => r.text())).toEqual(['util', 'app.ts300 B', 'README.md2.0 KB'])
    expect(rows[0].find('[data-icon="folder"]').exists()).toBe(true)
    expect(wrapper.find('.abele-github-folder__readme-name').text()).toBe('README.md')
    expect(onTitle).toHaveBeenLastCalledWith('src/ @ main')
    expect(model.screen.kind).toBe('tree')
    expect(model.screen.link).toEqual({
      label: 'o/r@main · src/',
      url: 'https://github.com/o/r/tree/main/src',
    })

    await click(rows[1].element)
    expect(onOpen).toHaveBeenLastCalledWith('https://github.com/o/r/blob/main/src/app.ts', false)
    await click(rows[0].element, { ctrlKey: true })
    expect(onOpen).toHaveBeenLastCalledWith('https://github.com/o/r/tree/main/src/util', 'tab')
  })

  it('a file link that names a folder lists the folder, as GitHub does', async () => {
    const { wrapper } = openTab('https://github.com/o/r/blob/main/src', {
      ...REPO,
      '/repos/o/r/contents/src': (req) =>
        /raw/.test(String(req.headers?.Accept))
          ? {
              text: JSON.stringify([
                { name: 'app.ts', path: 'src/app.ts', type: 'file', _links: {} },
              ]),
            }
          : { json: [{ name: 'app.ts', path: 'src/app.ts', type: 'file', size: 3 }] },
    })
    await flushPromises()
    expect(wrapper.findAll('.abele-github-folder .tree-item-self').map((r) => r.text())).toEqual([
      'app.ts3 B',
    ])
  })
})

describe('a diff header', () => {
  it("links each folder of the file's path to its listing at the pull request's head", async () => {
    const { wrapper, onOpen } = openTab('https://github.com/o/r/pull/7/files', PULL_ROUTES)
    await vi.waitFor(() =>
      expect(wrapper.find('.abele-github-file__folder-link').exists()).toBe(true)
    )

    const folders = wrapper.findAll('.abele-github-file__folder-link')
    expect(folders.map((a) => [a.text(), a.attributes('href')])).toEqual([
      ['src', `https://github.com/o/r/tree/${HEAD}/src`],
      ['util', `https://github.com/o/r/tree/${HEAD}/src/util`],
    ])
    expect(wrapper.find('.abele-github-file__path').text()).toBe('src/util/format.ts')
    await click(folders[1].element)
    expect(onOpen).toHaveBeenLastCalledWith(`https://github.com/o/r/tree/${HEAD}/src/util`, false)
  })
})

describe('the file tree panel', () => {
  it('opens beside a file, at its version, with the file marked and its folders open', async () => {
    const { wrapper, model, onOpen } = openTab(
      'https://github.com/o/r/blob/main/src/util/format.ts',
      REPO
    )
    await flushPromises()
    expect(wrapper.find('.abele-github-tree').exists()).toBe(false)

    await click(headerIcon(wrapper, 'folder-tree'))
    expect(model.tree).toBe(true)
    await vi.waitFor(() => expect(row(wrapper, 'src/util/format.ts').exists()).toBe(true))

    expect(row(wrapper, 'src/util/format.ts').classes()).toContain('is-active')
    expect(row(wrapper, 'src').attributes('aria-expanded')).toBe('true')
    expect(row(wrapper, 'docs').attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.abele-github-tree__head .abele-badge').text()).toBe('main')

    // Another file opens at the same ref, in this tab; Mod-click in a new one.
    await click(row(wrapper, 'src/util/parse.ts').element)
    expect(onOpen).toHaveBeenLastCalledWith(
      'https://github.com/o/r/blob/main/src/util/parse.ts',
      false
    )
    await click(row(wrapper, 'README.md').element, { metaKey: true })
    expect(onOpen).toHaveBeenLastCalledWith('https://github.com/o/r/blob/main/README.md', 'tab')
    // Picked beside the content, the panel stays.
    expect(model.tree).toBe(true)

    // A folder folds and unfolds.
    await click(row(wrapper, 'docs').element)
    expect(row(wrapper, 'docs/guide.md').exists()).toBe(true)
    await click(row(wrapper, 'docs').element)
    expect(row(wrapper, 'docs/guide.md').exists()).toBe(false)
  })

  it("stays at a pull request's head commit", async () => {
    const { wrapper, onOpen } = openTab('https://github.com/o/r/pull/7', PULL_ROUTES)
    await flushPromises()
    await click(headerIcon(wrapper, 'folder-tree'))
    await vi.waitFor(() => expect(row(wrapper, 'README.md').exists()).toBe(true))
    await click(row(wrapper, 'README.md').element)
    expect(onOpen).toHaveBeenLastCalledWith(`https://github.com/o/r/blob/${HEAD}/README.md`, false)
  })

  it('is at the default branch for an issue', async () => {
    const { wrapper, onOpen } = openTab('https://github.com/o/r/issues/5', {
      ...REPO,
      '/repos/o/r/issues/5': {
        json: { title: 'A bug', number: 5, user: { login: 'b' }, state: 'open', labels: [] },
      },
      '/repos/o/r/issues/5/comments': { json: [] },
    })
    await flushPromises()
    await click(headerIcon(wrapper, 'folder-tree'))
    await vi.waitFor(() => expect(row(wrapper, 'README.md').exists()).toBe(true))
    await click(row(wrapper, 'README.md').element)
    expect(onOpen).toHaveBeenLastCalledWith('https://github.com/o/r/blob/main/README.md', false)
  })

  it('filters by name, opening the folders on the way', async () => {
    const { wrapper, model } = openTab('https://github.com/o/r/blob/main/README.md', {
      ...REPO,
      '/repos/o/r/contents/README.md': { text: '# R\n' },
    })
    model.tree = true
    await vi.waitFor(() => expect(row(wrapper, 'src').exists()).toBe(true))
    expect(row(wrapper, 'src/util/parse.ts').exists()).toBe(false)

    const input = wrapper.find('.abele-github-tree__filter input')
    ;(input.element as HTMLInputElement).value = 'PARSE'
    await input.trigger('input')
    await flushPromises()

    expect(
      wrapper.findAll('.abele-github-tree .tree-item-self').map((r) => r.attributes('data-path'))
    ).toEqual(['src', 'src/util', 'src/util/parse.ts'])
    ;(input.element as HTMLInputElement).value = 'nothing-like-it'
    await input.trigger('input')
    await flushPromises()
    expect(wrapper.find('.abele-github-tree__note').text()).toContain('No name holds')
  })

  it('remembers the choice on a desktop, for the next tab', async () => {
    const { wrapper } = openTab('https://github.com/o/r/blob/main/src/util/format.ts', REPO)
    await flushPromises()
    await click(headerIcon(wrapper, 'folder-tree'))
    const app = GlobalStore.getInstance().app
    expect(app.loadLocalStorage(PANEL_KEY)).toBe(true)

    const next = openTab('https://github.com/o/r/blob/main/src/util/format.ts', REPO)
    await flushPromises()
    expect(next.wrapper.find('.abele-github-tree').exists()).toBe(true)
  })

  it('starts closed on a phone, and gets out of the way once a file is picked', async () => {
    GlobalStore.getInstance().app.saveLocalStorage(PANEL_KEY, true)
    Platform.isPhone = true
    const { wrapper, model, onOpen } = openTab(
      'https://github.com/o/r/blob/main/src/util/format.ts',
      REPO
    )
    await flushPromises()
    expect(wrapper.find('.abele-github-tree').exists()).toBe(false)

    await click(headerIcon(wrapper, 'folder-tree'))
    await vi.waitFor(() => expect(row(wrapper, 'src/app.ts').exists()).toBe(true))
    // The drawer: over the content, as the phone's stylesheet places it.
    ;(wrapper.find('.abele-github-layout__panel').element as HTMLElement).style.position =
      'absolute'
    await click(row(wrapper, 'src/app.ts').element)
    expect(onOpen).toHaveBeenLastCalledWith('https://github.com/o/r/blob/main/src/app.ts', false)
    expect(model.tree).toBe(false)
    // The phone's closing is not remembered as a choice.
    expect(GlobalStore.getInstance().app.loadLocalStorage(PANEL_KEY)).toBe(true)
  })

  it('closes from its own button, and from the backdrop beside the drawer', async () => {
    const { wrapper, model } = openTab('https://github.com/o/r/blob/main/src/util/format.ts', REPO)
    model.tree = true
    await flushPromises()
    await click(wrapper.find('.abele-github-tree__close').element)
    expect(model.tree).toBe(false)
    model.tree = true
    await flushPromises()
    await click(wrapper.find('.abele-github-layout__backdrop').element)
    expect(model.tree).toBe(false)
  })
})
