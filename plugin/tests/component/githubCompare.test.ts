/**
 * A comparison in a GitHub tab: the two sides in the title, how far apart they are, the commits,
 * the changed files drawn with the pull request's own diff view, a file anchor followed, the sides
 * swapped, and the comparison opened on GitHub.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { file, openTab as open } from '../helpers/githubTab'
import { diffAnchorHash } from '@/github/urls'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([])
  document.body.replaceChildren()
})

const HEAD = 'a'.repeat(40)
const BASE = 'b'.repeat(40)

const commit = (n: number, message: string) => ({
  sha: String(n).padStart(40, '0'),
  commit: { message, author: { name: 'Mona', date: '2026-01-01T00:00:00Z' } },
  author: { login: 'octocat' },
})

const COMPARE = {
  status: 'diverged',
  ahead_by: 2,
  behind_by: 1,
  total_commits: 2,
  merge_base_commit: { sha: BASE },
  commits: [commit(1, 'Add the greeting\n\nLonger text'), commit(2, 'Fix a typo')],
  files: ['a.ts', 'src/target.ts'].map((n) => ({
    ...file(n),
    contents_url: `https://api.github.com/repos/octocat/Hello-World/contents/${n}?ref=${HEAD}`,
  })),
}

const URL = 'https://github.com/octocat/Hello-World/compare/master...octocat-patch-1'
const routes = { '/repos/octocat/Hello-World/compare/master...octocat-patch-1': { json: COMPARE } }

describe('a comparison', () => {
  it('titles itself by its two sides and says how far apart they are', async () => {
    const { wrapper, onTitle, model } = open(URL, routes)
    await vi.waitFor(() => expect(wrapper.find('.abele-github-compare').exists()).toBe(true))

    expect(wrapper.find('.abele-github-header__title').text()).toBe('master...octocat-patch-1')
    expect(wrapper.findAll('.abele-badge').map((b) => b.text())).toEqual(['diverged'])
    const meta = wrapper.find('.abele-github-header__meta').text()
    expect(meta).toContain('2 commits ahead')
    expect(meta).toContain('1 behind')
    expect(meta).toContain('+4 −2')
    expect(onTitle).toHaveBeenLastCalledWith('octocat/Hello-World master...octocat-patch-1')
    // An agent asking what is on screen learns it is a comparison, on its files.
    expect(model.screen.kind).toBe('compare')
    expect(model.screen.section).toBe('files')
    expect(model.screen.link?.url).toBe(URL)
  })

  it('opens on the changed files, drawn with the diff view', async () => {
    const { wrapper } = open(URL, routes)
    await vi.waitFor(() => expect(wrapper.findAll('.abele-github-file')).toHaveLength(2))
    expect(wrapper.findAll('.abele-tabs__label').map((t) => t.text())).toEqual([
      'Files (2)',
      'Commits (2)',
    ])
    expect(wrapper.findAll('.abele-github-file .cm-editor')).toHaveLength(2)
  })

  it('lists the commits, each opening in the tab', async () => {
    const { wrapper, onOpen, model } = open(URL, routes)
    await vi.waitFor(() => expect(wrapper.find('.abele-tabs').exists()).toBe(true))
    await wrapper.findAll('.abele-tabs__tab')[1].trigger('click')
    await flushPromises()

    const cards = wrapper.findAll('.abele-github-compare .abele-card')
    expect(cards.map((c) => c.find('.abele-card__title').text())).toEqual([
      'Add the greeting',
      'Fix a typo',
    ])
    expect(model.screen.section).toBe('commits')
    await cards[1].trigger('click')
    expect(onOpen).toHaveBeenLastCalledWith(
      `https://github.com/octocat/Hello-World/commit/${commit(2, '').sha}`,
      false
    )
  })

  it('follows a file anchor to that file and marks the line', async () => {
    const hash = await diffAnchorHash('src/target.ts')
    const { wrapper } = open(`${URL}#diff-${hash}R3`, routes)
    await vi.waitFor(() =>
      expect(wrapper.findAll('.abele-github-code__line_target')).toHaveLength(1)
    )
    expect(wrapper.find('.abele-github-code__line_target').text()).toBe('d')
  })

  it('swaps its sides in the same tab, and opens on GitHub', async () => {
    const open_ = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { wrapper, onOpen } = open(URL, routes)
    await vi.waitFor(() => expect(wrapper.find('.abele-github-compare').exists()).toBe(true))

    const icon = (label: RegExp) =>
      wrapper
        .findAll('.abele-github-header__actions .abele-obsidian-icon')
        .find((i) => label.test(i.attributes('aria-label') ?? ''))!
    await icon(/Swap/).trigger('click')
    expect(onOpen).toHaveBeenLastCalledWith(
      'https://github.com/octocat/Hello-World/compare/octocat-patch-1...master',
      false
    )
    await icon(/on GitHub/).trigger('click')
    expect(open_).toHaveBeenLastCalledWith(URL)
    open_.mockRestore()
  })

  it('compares a lone ref with the default branch, and names that branch', async () => {
    const { wrapper } = open('https://github.com/octocat/Hello-World/compare/topic', {
      '/repos/octocat/Hello-World': { json: { default_branch: 'master' } },
      '/repos/octocat/Hello-World/compare/master...topic': {
        json: { ...COMPARE, status: 'ahead', behind_by: 0 },
      },
    })
    await vi.waitFor(() => expect(wrapper.find('.abele-github-compare').exists()).toBe(true))
    expect(wrapper.find('.abele-github-header__title').text()).toBe('master...topic')
  })

  it('says when the two are the same', async () => {
    const { wrapper } = open(URL, {
      '/repos/octocat/Hello-World/compare/master...octocat-patch-1': {
        json: {
          status: 'identical',
          ahead_by: 0,
          behind_by: 0,
          total_commits: 0,
          commits: [],
          files: [],
        },
      },
    })
    await vi.waitFor(() => expect(wrapper.find('.abele-github-compare').exists()).toBe(true))
    expect(wrapper.text()).toContain('These two are the same')
  })

  it('says what two dots cannot show, with nothing to try again', async () => {
    const { wrapper } = open(
      'https://github.com/octocat/Hello-World/compare/master..octocat-patch-1',
      routes
    )
    await vi.waitFor(() => expect(wrapper.find('.abele-github-notice').exists()).toBe(true))
    expect(wrapper.find('.abele-github-notice').text()).toMatch(/side by side/)
    expect(wrapper.find('.abele-github-notice button').exists()).toBe(false)
  })

  it('is a full-tab error, with a way to try again, when GitHub has no such comparison', async () => {
    const { wrapper } = open(URL, {})
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.find('.abele-github__error').exists()).toBe(true))
  })
})

describe('a comparison of commits', () => {
  it('titles its sides by their short SHAs, as GitHub does', async () => {
    const base = 'c'.repeat(40)
    const { wrapper } = open(`https://github.com/octocat/Hello-World/compare/${base}...main`, {
      [`/repos/octocat/Hello-World/compare/${base}...main`]: { json: COMPARE },
    })
    await vi.waitFor(() => expect(wrapper.find('.abele-github-compare').exists()).toBe(true))
    expect(wrapper.find('.abele-github-header__title').text()).toBe('ccccccc...main')
  })
})
