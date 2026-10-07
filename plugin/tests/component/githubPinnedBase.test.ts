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
