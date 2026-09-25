/**
 * Search inside a GitHub tab: the find bar Mod+F opens, and the code search panel with its three
 * scopes — the change itself, the whole repository at the tab's commit, file names — whose
 * results open where they point, in a new tab on Mod-click.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { ISSUE, PULL, file, openTab } from '../helpers/githubTab'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_GITHUB_SETTINGS } from '@/github/settings'
import { indexes } from '@/github/search/source'

const archive = new Uint8Array(
  readFileSync(resolve(__dirname, '../fixtures/github/widgets.tar.gz'))
)
const SHA = '9bafc7b0401748aa7ce64a89653af1a32c4c6143'

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r, 0))
  }
}

beforeEach(() => {
  useVault([])
  document.body.replaceChildren()
  indexes.clear()
  AbeleConfig.getInstance().github = { ...DEFAULT_GITHUB_SETTINGS, enabled: true }
})

const issueRoutes = {
  '/repos/o/r/issues/5': { json: ISSUE },
  '/repos/o/r/issues/5/comments': {
    json: [
      { id: 9, user: { login: 'ann' }, body: 'It crashes for me too', created_at: '2026-01-02' },
    ],
  },
}

const type = async (input: HTMLInputElement, value: string) => {
  input.value = value
  input.dispatchEvent(new Event('input'))
  await new Promise((r) => setTimeout(r, 150))
  await flushPromises()
}

const key = (el: Element, k: string, extra: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }))

describe('find in the tab', () => {
  it('opens on Mod+F, counts the matches and walks them with Enter', async () => {
    const { wrapper, keys } = openTab('https://github.com/o/r/issues/5', issueRoutes)
    await flushPromises()
    expect(wrapper.find('.abele-github-find').exists()).toBe(false)

    keys.find++
    await flushPromises()
    const input = wrapper.find<HTMLInputElement>('.abele-github-find__input').element
    expect(document.activeElement).toBe(input)

    await type(input, 'crash')
    // The title, the body and the comment each say it once.
    expect(wrapper.find('.abele-github-find__count').text()).toBe('1 of 3')

    key(input, 'Enter')
    await flushPromises()
    expect(wrapper.find('.abele-github-find__count').text()).toBe('2 of 3')
    key(input, 'Enter', { shiftKey: true })
    key(input, 'Enter', { shiftKey: true })
    await flushPromises()
    expect(wrapper.find('.abele-github-find__count').text()).toBe('3 of 3')

    key(input, 'Escape')
    await flushPromises()
    expect(wrapper.find('.abele-github-find').exists()).toBe(false)
  })

  it('opens from the header too, and says when there is nothing', async () => {
    const { wrapper } = openTab('https://github.com/o/r/issues/5', issueRoutes)
    await flushPromises()
    const header = wrapper.findAll('.abele-github-header__actions .abele-obsidian-icon')
    await header
      .find((i) => i.attributes('aria-label')?.startsWith('Find in this tab'))!
      .trigger('click')
    await flushPromises()
    await type(wrapper.find<HTMLInputElement>('.abele-github-find__input').element, 'zebra')
    expect(wrapper.find('.abele-github-find__count').text()).toBe('No results')
  })
})

describe('the code search panel', () => {
  const pullRoutes = {
    '/repos/o/r/pulls/7': { json: { ...PULL, head: { label: 'ann:fix', sha: SHA } } },
    '/repos/o/r/issues/7/comments': { json: [] },
    '/repos/o/r/pulls/7/reviews': { json: [] },
    '/repos/o/r/pulls/7/comments': { json: [] },
    '/repos/o/r/pulls/7/files': {
      json: [file('src/app.ts', '@@ -1,2 +1,2 @@\n keep\n-old formatName\n+new formatName')],
    },
    [`/repos/o/r/git/trees/${SHA}`]: {
      json: {
        truncated: false,
        tree: [
          { path: 'src/app.ts', type: 'blob', size: 247 },
          { path: 'src/util/format.ts', type: 'blob', size: 134 },
        ],
      },
    },
    [`/repos/o/r/tarball/${SHA}`]: { bytes: archive },
    '/repos/o/r/contents/src/app.ts': { text: 'import { formatName } from "./util/format"\n' },
  }

  const openPanel = async () => {
    const tab = openTab('https://github.com/o/r/pull/7', pullRoutes)
    await flushPromises()
    const icon = tab.wrapper
      .findAll('.abele-github-header__actions .abele-obsidian-icon')
      .find((i) => i.attributes('aria-label')?.startsWith('Search the code'))!
    await icon.trigger('click')
    await flushPromises()
    return tab
  }

  const search = async (wrapper: Awaited<ReturnType<typeof openPanel>>['wrapper'], q: string) => {
    const input = wrapper.find<HTMLInputElement>('.abele-github-search__query')
    await input.setValue(q)
    key(input.element, 'Enter')
    await settle()
  }

  it('offers the change, the whole repository at its head, and file names', async () => {
    const { wrapper } = await openPanel()
    const options = wrapper.findAll('.abele-github-search__scope option').map((o) => o.text())
    expect(options).toEqual([
      'Only the changed files',
      'Whole repository at ann:fix',
      'File names at ann:fix',
    ])
  })

  it('searches the changed lines and opens a result at its line in the diff', async () => {
    const { wrapper, onOpen } = await openPanel()
    await search(wrapper, 'formatName')

    // The diffs are read before the answer shows; a loaded run takes more turns than settle() gives.
    await vi.waitFor(() => expect(wrapper.findAll('.abele-github-search__line')).toHaveLength(2))
    const lines = wrapper.findAll('.abele-github-search__line')
    expect(lines.map((l) => l.find('.abele-github-search__number').text())).toEqual([
      '2 before',
      '2',
    ])
    expect(wrapper.find('.abele-github-search__match').text()).toBe('formatName')

    await lines[1].trigger('click')
    expect(onOpen.mock.calls[0][0]).toMatch(/\/pull\/7\/files#diff-[0-9a-f]{64}R2$/)
    expect(onOpen.mock.calls[0][1]).toBe(false)

    lines[0].element.dispatchEvent(new MouseEvent('click', { metaKey: true, bubbles: true }))
    expect(onOpen.mock.calls[1][0]).toMatch(/L2$/)
    expect(onOpen.mock.calls[1][1]).toBe('tab')
  })

  it('searches the whole repository at the head commit, and links the file there', async () => {
    const { wrapper, onOpen } = await openPanel()
    const select = wrapper.find<HTMLSelectElement>('.abele-github-search__scope select')
    await select.setValue('repo')
    await search(wrapper, 'formatName')

    // The index is built from the archive, which gunzips off the main thread: no fixed number of
    // turns is sure to see it finish under a loaded run, so wait for the answer itself.
    await vi.waitFor(() =>
      expect(
        wrapper.findAll('.abele-github-search__path').map((p) => p.find('span').text())
      ).toEqual(['src/app.ts', 'src/util/format.ts'])
    )
    await wrapper.findAll('.abele-github-search__line')[0].trigger('click')
    expect(onOpen.mock.calls[0][0]).toBe(`https://github.com/o/r/blob/${SHA}/src/app.ts#L1`)
  })

  it('searches the changes of a comparison and opens a result at its line there', async () => {
    const tab = openTab('https://github.com/o/r/compare/main...fix', {
      '/repos/o/r/compare/main...fix': {
        json: {
          status: 'ahead',
          ahead_by: 1,
          behind_by: 0,
          total_commits: 1,
          commits: [],
          files: [
            {
              ...file('src/app.ts', '@@ -1,2 +1,2 @@\n keep\n-old formatName\n+new formatName'),
              contents_url: `https://api.github.com/repos/o/r/contents/src/app.ts?ref=${SHA}`,
            },
          ],
        },
      },
    })
    await flushPromises()
    const icon = tab.wrapper
      .findAll('.abele-github-header__actions .abele-obsidian-icon')
      .find((i) => i.attributes('aria-label')?.startsWith('Search the code'))!
    await icon.trigger('click')
    await flushPromises()
    const options = tab.wrapper.findAll('.abele-github-search__scope option').map((o) => o.text())
    expect(options).toEqual([
      'Only the changed files',
      'Whole repository at fix',
      'File names at fix',
    ])
    await search(tab.wrapper, 'formatName')
    await vi.waitFor(() =>
      expect(tab.wrapper.findAll('.abele-github-search__line').length).toBeGreaterThan(1)
    )
    const lines = tab.wrapper.findAll('.abele-github-search__line')
    await lines[1].trigger('click')
    expect(tab.onOpen.mock.calls[0][0]).toMatch(/\/compare\/main\.\.\.fix#diff-[0-9a-f]{64}R2$/)
  })

  it('finds file names as they are typed', async () => {
    const { wrapper } = await openPanel()
    await wrapper.find<HTMLSelectElement>('.abele-github-search__scope select').setValue('names')
    await wrapper.find<HTMLInputElement>('.abele-github-search__query').setValue('format')
    await vi.waitFor(() =>
      expect(wrapper.findAll('.abele-github-search__path').map((p) => p.text())).toEqual([
        'src/util/format.ts',
      ])
    )
  })

  it('keeps its results when a result is followed, and searches the repository from the file', async () => {
    const { wrapper, model } = await openPanel()
    await search(wrapper, 'formatName')
    const { parseGithubUrl } = await import('@/github/urls')
    const url = `https://github.com/o/r/blob/${SHA}/src/app.ts#L1`
    model.url = url
    model.target = parseGithubUrl(url, ['github.com'])
    model.nonce++
    await settle()
    const options = wrapper.findAll('.abele-github-search__scope option').map((o) => o.text())
    expect(options[0]).toMatch(/^Whole repository at/)
    expect(
      wrapper.find<HTMLSelectElement>('.abele-github-search__scope select').element.value
    ).toBe('repo')
    expect(wrapper.findAll('.abele-github-search__line').length).toBeGreaterThan(0)
  })

  it('says a malformed regular expression is one, instead of searching', async () => {
    const { wrapper } = await openPanel()
    const regex = wrapper
      .findAll('.abele-github-search__toggles .abele-obsidian-icon')
      .find((i) => i.attributes('aria-label')?.includes('regular expression'))!
    await regex.trigger('click')
    await search(wrapper, '(')
    expect(wrapper.find('.abele-github-search__error').text()).toMatch(
      /Not a valid regular expression/
    )
  })
})
