import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { openTab, clientWith } from '../helpers/githubTab'
import { useVault } from '../helpers/testEnv'
import { GlobalStore } from '@/stores/GlobalStore'
import { basePins } from '@/github/comparison/pins'
import { parseGithubUrl } from '@/github/urls'

const BASE = 'a'.repeat(40),
  TARGET = 'b'.repeat(40),
  OTHER = 'c'.repeat(40)
const REPO = { host: 'github.com', owner: 'sample', repo: 'project' }
const URL = `https://github.com/sample/project/blob/${TARGET}/file.ts#L4`
const text = (value: string) => ({ encoding: 'base64', content: btoa(value) })
const routes = {
  [`/repos/sample/project/git/trees/${BASE}`]: {
    json: {
      tree: [
        { path: 'file.ts', type: 'blob', size: 30, sha: 'old', mode: '100644' },
        { path: 'gone.ts', type: 'blob', size: 5, sha: 'gone', mode: '100644' },
        { path: 'stable.ts', type: 'blob', size: 5, sha: 'stable', mode: '100644' },
      ],
    },
  },
  [`/repos/sample/project/git/trees/${TARGET}`]: {
    json: {
      tree: [
        { path: 'file.ts', type: 'blob', size: 30, sha: 'new', mode: '100644' },
        { path: 'stable.ts', type: 'blob', size: 5, sha: 'stable', mode: '100644' },
      ],
    },
  },
  [`/repos/sample/project/git/trees/${OTHER}`]: {
    json: { tree: [{ path: 'file.ts', type: 'blob', size: 30, sha: 'other', mode: '100644' }] },
  },
  '/repos/sample/project/git/blobs/old': { json: text('one\nold\nthree\nfour\n') },
  '/repos/sample/project/git/blobs/new': { json: text('one\nnew\nthree\nfour\n') },
  '/repos/sample/project/git/blobs/other': { json: text('one\nother\nthree\nfour\n') },
  '/repos/sample/project/git/blobs/gone': { json: text('gone\n') },
  '/repos/sample/project/git/blobs/stable': { json: text('same\n') },
  '/repos/sample/project/contents/file.ts': { text: 'Original file\n' },
}
const pins = () => basePins(GlobalStore.getInstance().app)
const button = (w: ReturnType<typeof openTab>['wrapper'], name: string) =>
  w.findAll('button').find((b) => b.text() === name)!
const pin = () =>
  pins().save({
    origin: 'https://github.com',
    owner: REPO.owner,
    repo: REPO.repo,
    enteredRef: 'topic/base',
    baseSha: BASE,
  })
beforeEach(() => {
  useVault([])
  document.body.replaceChildren()
  pins().unpin(REPO)
})

describe('a pinned project tree', () => {
  it.each([true, false])(
    'opens all file/folder replacement entries in both project modes (base folder: %s)',
    async (baseFolder) => {
      pin()
      const oldPath = baseFolder ? 'pkg/old.ts' : 'pkg',
        newPath = baseFolder ? 'pkg' : 'pkg/new.ts'
      const { wrapper, model, onOpen } = openTab(
        `https://github.com/sample/project/blob/${TARGET}/${newPath}`,
        {
          ...routes,
          [`/repos/sample/project/git/trees/${BASE}`]: {
            json: { tree: [{ path: oldPath, type: 'blob', sha: 'old', size: 4 }] },
          },
          [`/repos/sample/project/git/trees/${TARGET}`]: {
            json: { tree: [{ path: newPath, type: 'blob', sha: 'new', size: 4 }] },
          },
        }
      )
      model.tree = true
      await vi.waitFor(() =>
        expect(wrapper.findAll('.abele-github-tree [data-path="pkg"]')).toHaveLength(2)
      )
      if (baseFolder)
        await wrapper.find('.abele-github-tree [data-path="pkg"][aria-expanded]').trigger('click')
      expect(
        wrapper.find(`.abele-github-tree [data-path="${oldPath}"]:not([aria-expanded])`).text()
      ).toContain('removed')
      const changed = wrapper
        .findAll('.abele-github-tree .abele-tabs__tab')
        .find((t) => t.text() === 'Changed files')!
      await changed.trigger('click')
      expect(wrapper.findAll('.abele-github-tree [data-path="pkg"]')).toHaveLength(2)
      await wrapper
        .find(`.abele-github-tree [data-path="${oldPath}"]:not([aria-expanded])`)
        .trigger('click')
      expect(onOpen).toHaveBeenLastCalledWith(
        `https://github.com/sample/project/blob/${TARGET}/${oldPath}`,
        false
      )
      model.url = `https://github.com/sample/project/blob/${TARGET}/${oldPath}`
      model.target = parseGithubUrl(model.url, ['github.com'])
      model.nonce++
      await vi.waitFor(() =>
        expect(wrapper.find('.abele-github-pinned').text()).toContain('removed')
      )
      expect(model.screen.comparison?.targetSha).toBe(TARGET)
      wrapper.unmount()
    }
  )
  const homeRoutes = (branch: () => string) => ({
    ...routes,
    '/repos/sample/project': {
      json: {
        name: 'project',
        owner: { login: 'sample' },
        default_branch: 'main',
        html_url: 'https://github.com/sample/project',
      },
    },
    '/repos/sample/project/commits/main': () => ({ text: branch() }),
    '/repos/sample/project/contents': {
      json: [{ name: 'file.ts', path: 'file.ts', type: 'file', size: 30 }],
    },
    '/repos/sample/project/contents/pkg': {
      json: [{ name: 'file.ts', path: 'pkg/file.ts', type: 'file', size: 30 }],
    },
    [`/repos/sample/project/git/trees/${TARGET}`]: {
      json: {
        tree: [
          { path: 'file.ts', type: 'blob', size: 30, sha: 'new' },
          { path: 'pkg/file.ts', type: 'blob', size: 30, sha: 'new' },
        ],
      },
    },
  })
  it.each(['', '/tree/main/pkg'])(
    'freezes tree links on a project page %s before a branch moves',
    async (suffix) => {
      pin()
      let branch = TARGET
      const { wrapper, model, onOpen } = openTab(
        `https://github.com/sample/project${suffix}`,
        homeRoutes(() => branch)
      )
      model.tree = true
      const path = suffix ? 'pkg/file.ts' : 'file.ts'
      await vi.waitFor(() =>
        expect(wrapper.find(`.abele-github-tree [data-path="${path}"]`).exists()).toBe(true)
      )
      branch = OTHER
      await wrapper.find(`.abele-github-tree [data-path="${path}"]`).trigger('click')
      expect(onOpen).toHaveBeenLastCalledWith(
        `https://github.com/sample/project/blob/${TARGET}/${path}`,
        false
      )
      wrapper.unmount()
    }
  )
  it('retains the project target after closing and reopening its tree', async () => {
    pin()
    let branch = TARGET
    const { wrapper, model, onOpen, request } = openTab(
      'https://github.com/sample/project',
      homeRoutes(() => branch)
    )
    model.tree = true
    await vi.waitFor(() =>
      expect(wrapper.find('.abele-github-tree [data-path="file.ts"]').exists()).toBe(true)
    )
    model.tree = false
    await flushPromises()
    expect(wrapper.find('.abele-github-tree').exists()).toBe(false)
    branch = OTHER
    model.tree = true
    await vi.waitFor(() =>
      expect(wrapper.find('.abele-github-tree [data-path="file.ts"]').exists()).toBe(true)
    )
    await wrapper.find('.abele-github-tree [data-path="file.ts"]').trigger('click')
    expect(onOpen).toHaveBeenLastCalledWith(
      `https://github.com/sample/project/blob/${TARGET}/file.ts`,
      false
    )
    expect(request.mock.calls.filter(([r]) => r.url.endsWith('/commits/main'))).toHaveLength(1)
    wrapper.unmount()
  })
  it.each([`/pull/7`, `/commit/${TARGET}`, `/compare/${OTHER}...${TARGET}`])(
    'does not apply the repository base to an explicit page tree %s',
    async (suffix) => {
      pin()
      const { wrapper, model, request } = openTab(`https://github.com/sample/project${suffix}`, {
        ...routes,
        '/repos/sample/project/pulls/7': {
          json: {
            title: 'Sample change',
            head: { sha: TARGET },
            base: { sha: OTHER },
            user: {},
            html_url: 'https://github.com/sample/project/pull/7',
          },
        },
        '/repos/sample/project/issues/7/comments': { json: [] },
        '/repos/sample/project/pulls/7/reviews': { json: [] },
        '/repos/sample/project/pulls/7/comments': { json: [] },
        [`/repos/sample/project/commits/${TARGET}`]: {
          json: {
            sha: TARGET,
            commit: { message: 'Sample change', author: {} },
            parents: [{ sha: OTHER }],
            files: [],
          },
        },
        [`/repos/sample/project/compare/${OTHER}...${TARGET}`]: {
          json: {
            status: 'ahead',
            files: [],
            commits: [
              {
                sha: TARGET,
                commit: {
                  message: 'Sample change',
                  author: { name: 'Sample', date: '2026-01-01' },
                },
              },
            ],
            total_commits: 1,
          },
        },
      })
      model.tree = true
      await vi.waitFor(() =>
        expect(wrapper.find('.abele-github-tree [data-path="file.ts"]').exists()).toBe(true)
      )
      expect(wrapper.find('.abele-github-tree .abele-tabs').exists()).toBe(false)
      expect(wrapper.find('.abele-github-tree [data-path="gone.ts"]').exists()).toBe(false)
      expect(request.mock.calls.some(([r]) => r.url.includes(`/git/trees/${BASE}`))).toBe(false)
      wrapper.unmount()
    }
  )
  it('offers all/changed projections with agreeing counts, includes deletion and keeps its target', async () => {
    pin()
    const { wrapper, onOpen, model } = openTab(URL, routes)
    model.tree = true
    await vi.waitFor(() =>
      expect(wrapper.find('.abele-github-tree [data-path="gone.ts"]').exists()).toBe(true)
    )
    expect(wrapper.find('.abele-github-tree [data-path="file.ts"]').text()).toContain('+1 −1')
    expect(wrapper.find('.abele-github-tree [data-path="stable.ts"]').exists()).toBe(true)
    const changed = wrapper.findAll('.abele-tabs__tab').find((t) => t.text() === 'Changed files')!
    await changed.trigger('click')
    expect(wrapper.find('.abele-github-tree [data-path="stable.ts"]').exists()).toBe(false)
    expect(wrapper.find('.abele-github-tree [data-path="file.ts"]').text()).toContain('+1 −1')
    await wrapper.find('.abele-github-tree [data-path="gone.ts"]').trigger('click')
    expect(onOpen).toHaveBeenLastCalledWith(
      `https://github.com/sample/project/blob/${TARGET}/gone.ts`,
      false
    )
    model.url = `https://github.com/sample/project/blob/${TARGET}/gone.ts`
    model.target = parseGithubUrl(model.url, ['github.com'])
    model.nonce++
    await vi.waitFor(() => expect(wrapper.find('.abele-github-pinned').text()).toContain('removed'))
    expect(model.screen.comparison?.targetSha).toBe(TARGET)
    wrapper.unmount()
  })
})

describe('a pinned file tab', () => {
  it('still promotes blob-style folder links and reads the folder at the resolved target', async () => {
    pin()
    const { wrapper, request, model } = openTab(
      'https://github.com/sample/project/blob/main/packages/core',
      {
        ...routes,
        '/repos/sample/project/commits/main': { text: TARGET },
        [`/repos/sample/project/git/trees/${TARGET}`]: {
          json: { tree: [{ path: 'packages/core', type: 'tree', sha: 'core' }] },
        },
        '/repos/sample/project/contents/packages/core': {
          json: [{ name: 'index.ts', path: 'packages/core/index.ts', type: 'file', size: 4 }],
        },
      }
    )
    await vi.waitFor(() => expect(wrapper.find('.abele-github-folder').exists()).toBe(true))
    expect(model.screen.kind).toBe('tree')
    expect(wrapper.find('.abele-github-folder').text()).toContain('index.ts')
    expect(
      request.mock.calls
        .filter(([r]) => r.url.includes('/contents/packages/core'))
        .every(([r]) => new globalThis.URL(r.url).searchParams.get('ref') === TARGET)
    ).toBe(true)
    wrapper.unmount()
  })
  it('ignores a delayed private diff after unpinning during its load', async () => {
    pin()
    const connection = clientWith(routes),
      get = connection.client.get.bind(connection.client)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(connection.client, 'get').mockImplementation(async (path, options) => {
      if (path.endsWith('/git/blobs/old')) await gate
      return get(path, options)
    })
    const { wrapper, model, request } = openTab(URL, routes, true, document.body, connection)
    await vi.waitFor(() =>
      expect(request.mock.calls.some(([r]) => r.url.endsWith('/git/blobs/new'))).toBe(true)
    )
    pins().unpin(REPO)
    await vi.waitFor(() =>
      expect(wrapper.find('.abele-github-blob').text()).toContain('Original file')
    )
    release()
    await flushPromises()
    expect(wrapper.find('.abele-github-pinned').exists()).toBe(false)
    expect(model.screen.comparison).toBeNull()
    wrapper.unmount()
  })
  it('keeps an already opened mutable target frozen when the base changes', async () => {
    pin()
    let branch = TARGET
    const { wrapper, model, request } = openTab(URL.replace(TARGET, 'main'), {
      ...routes,
      '/repos/sample/project/commits/main': () => ({ text: branch }),
    })
    await vi.waitFor(() => expect(model.screen.comparison?.targetSha).toBe(TARGET))
    branch = OTHER
    pins().save({
      origin: 'https://github.com',
      owner: REPO.owner,
      repo: REPO.repo,
      enteredRef: 'replacement',
      baseSha: OTHER,
    })
    await vi.waitFor(() => expect(model.screen.comparison?.baseSha).toBe(OTHER))
    expect(model.screen.comparison?.targetSha).toBe(TARGET)
    expect(request.mock.calls.filter(([r]) => r.url.endsWith('/commits/main'))).toHaveLength(1)
    wrapper.unmount()
  })
  it('shows exact full-file diff and linked target context outside the change', async () => {
    pin()
    const { wrapper, model } = openTab(URL, routes)
    await vi.waitFor(() =>
      expect(wrapper.find('.abele-github-pinned .cm-editor').exists()).toBe(true)
    )
    expect(wrapper.find('.abele-github-code__line_target').text()).toBe('four')
    expect(wrapper.find('.abele-github-code__line_add').text()).toBe('new')
    expect(wrapper.find('.abele-github-code__line_del').text()).toBe('old')
    expect(model.screen.comparison).toEqual({
      baseSha: BASE,
      targetSha: TARGET,
      baseRef: 'topic/base',
    })
    expect(model.url).toBe(URL)
    expect(button(wrapper, 'Original file')).toBeDefined()
    wrapper.unmount()
  })
  it('original-file escape is per tab, and unpin restores existing rendering in all tabs', async () => {
    pin()
    const a = openTab(URL, routes),
      b = openTab(URL, routes)
    await vi.waitFor(() => expect(a.wrapper.find('.abele-github-pinned').exists()).toBe(true))
    await vi.waitFor(() => expect(b.wrapper.find('.abele-github-pinned').exists()).toBe(true))
    await button(a.wrapper, 'Original file').trigger('click')
    await vi.waitFor(() =>
      expect(a.wrapper.find('.abele-github-blob').text()).toContain('Original file')
    )
    expect(b.wrapper.find('.abele-github-pinned').exists()).toBe(true)
    pins().unpin(REPO)
    await vi.waitFor(() =>
      expect(b.wrapper.find('.abele-github-blob').text()).toContain('Original file')
    )
    expect(b.model.screen.comparison).toBeNull()
    a.wrapper.unmount()
    b.wrapper.unmount()
  })
  it('keeps each tab target independent, applies new pins, and repeats line highlighting', async () => {
    pin()
    const a = openTab(URL, routes),
      b = openTab(URL.replace(TARGET, OTHER), routes)
    await vi.waitFor(() => expect(a.model.screen.comparison?.targetSha).toBe(TARGET))
    await vi.waitFor(() => expect(b.model.screen.comparison?.targetSha).toBe(OTHER))
    const repeated = URL.replace('#L4', '#L1')
    a.model.target = parseGithubUrl(repeated, ['github.com'])
    a.model.url = repeated
    a.model.nonce++
    await flushPromises()
    expect(a.wrapper.find('.abele-github-code__line_target').text()).toBe('one')
    pins().save({
      origin: 'https://github.com',
      owner: REPO.owner,
      repo: REPO.repo,
      enteredRef: 'replacement',
      baseSha: OTHER,
    })
    await vi.waitFor(() => expect(a.model.screen.comparison?.baseSha).toBe(OTHER))
    expect(b.model.screen.comparison?.targetSha).toBe(OTHER)
    a.wrapper.unmount()
    b.wrapper.unmount()
  })
  it('makes removed-line links at the base SHA, rather than fabricated local compare anchors', async () => {
    pin()
    const { wrapper, model } = openTab(URL, routes)
    await vi.waitFor(() => expect(wrapper.find('.abele-github-code__line_del').exists()).toBe(true))
    const gutter = wrapper.find('.abele-github-code__gutter_old')
    // happy-dom has no layout; CodeMirror estimates each unified row at 14 px.
    await gutter.trigger('mousedown', { buttons: 1, clientY: 21 })
    await gutter.trigger('mouseup')
    await flushPromises()
    expect(model.screen.selection?.url).toBe(
      `https://github.com/sample/project/blob/${BASE}/file.ts#L2`
    )
    expect(model.screen.selection?.side).toBe('base')
    wrapper.unmount()
  })
})
