/**
 * A repository's front page in a GitHub tab: what it says of itself, the ref it is at and the way
 * to another, its files and README, the freshest open pull requests and issues, the latest release
 * and its languages — and what is shown when GitHub refuses the page or a part of it.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { Platform } from 'obsidian'
import { openTab, type Route } from '../helpers/githubTab'
import { useVault } from '../helpers/testEnv'
import { forgetRepoTrees } from '@/github/tree/repoTree'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_GITHUB_SETTINGS } from '@/github/settings'
import GithubSettingsView from '@/components/settings/GithubSettings.vue'

const META = {
  name: 'r',
  owner: { login: 'o' },
  description: 'Widgets for the dashboard.',
  homepage: 'https://widgets.example.com',
  topics: ['dashboard', 'widgets'],
  stargazers_count: 1234,
  forks_count: 56,
  subscribers_count: 7,
  default_branch: 'main',
  license: { spdx_id: 'MIT', name: 'MIT License' },
  visibility: 'public',
  archived: false,
  has_issues: true,
  html_url: 'https://github.com/o/r',
}

const ROOT = [
  { name: 'src', path: 'src', type: 'dir', size: 0 },
  { name: 'README.md', path: 'README.md', type: 'file', size: 120 },
]

const pullItem = (number: number, title: string, draft = false) => ({
  number,
  title,
  draft,
  user: { login: 'ann' },
  created_at: '2026-09-01T10:00:00Z',
  html_url: `https://github.com/o/r/pull/${number}`,
})

const ROUTES: Record<string, Route> = {
  '/repos/o/r': { json: META },
  '/repos/o/r/contents': (req) =>
    /ref=dev/.test(req.url)
      ? { json: [{ name: 'DEV.md', path: 'DEV.md', type: 'file', size: 3 }] }
      : { json: ROOT },
  '/repos/o/r/contents/README.md': { text: '# Widgets\n\nSee [the guide](docs/guide.md).' },
  '/repos/o/r/languages': { json: { TypeScript: 7000, CSS: 2000, Shell: 1000 } },
  '/repos/o/r/pulls': {
    json: [pullItem(12, 'Page the loader'), pullItem(11, 'Try a new layout', true)],
  },
  '/repos/o/r/issues': {
    json: [
      { ...pullItem(12, 'Page the loader'), pull_request: {} },
      { ...pullItem(9, 'Loader hangs'), html_url: 'https://github.com/o/r/issues/9' },
    ],
  },
  '/repos/o/r/releases/latest': {
    json: {
      name: 'Widgets 2.0',
      tag_name: 'v2.0.0',
      published_at: '2026-09-10T10:00:00Z',
      html_url: 'https://github.com/o/r/releases/tag/v2.0.0',
    },
  },
}

const click = async (el: Element, init: MouseEventInit = {}) => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
  await flushPromises()
}

const loaded = async (w: VueWrapper) => {
  await vi.waitFor(() => expect(w.find('.abele-github-home').exists()).toBe(true))
  await flushPromises()
}

beforeEach(() => {
  useVault([])
  forgetRepoTrees()
  document.body.replaceChildren()
  Platform.isPhone = false
})

afterEach(() => vi.restoreAllMocks())

describe('a repository front page', () => {
  it('opens for the repository address, titled by the repository at its default branch', async () => {
    const { wrapper, onTitle, model } = openTab('https://github.com/o/r', ROUTES)
    await loaded(wrapper)

    const crumbs = wrapper.find('.abele-github-header__title')
    expect(crumbs.text()).toContain('o')
    expect(crumbs.text()).toContain('r')
    expect(wrapper.find('.abele-github-crumbs__ref').text()).toBe('main')
    expect(onTitle).toHaveBeenLastCalledWith('o/r')
    expect(model.screen.kind).toBe('repo')
    expect(model.screen.link).toEqual({ label: 'o/r', url: 'https://github.com/o/r' })
  })

  it('says what the repository says of itself', async () => {
    const { wrapper } = openTab('https://github.com/o/r', ROUTES)
    await loaded(wrapper)

    const about = wrapper.find('.abele-github-home__about')
    expect(about.text()).toContain('Widgets for the dashboard.')
    expect(about.find('a.external-link').attributes('href')).toBe('https://widgets.example.com/')
    expect(about.findAll('.abele-badge').map((b) => b.text())).toEqual(['dashboard', 'widgets'])
    const stats = wrapper.find('.abele-github-home__stats').text()
    expect(stats).toContain('1.2k')
    expect(stats).toContain('56')
    expect(stats).toContain('7')
    expect(stats).toContain('MIT')
  })

  it('lists the root and renders the README under it, its links resolved in the repository', async () => {
    const { wrapper } = openTab('https://github.com/o/r', ROUTES)
    await loaded(wrapper)
    await vi.waitFor(() =>
      expect(wrapper.find('.abele-github-folder__readme .abele-github-text').text()).toContain(
        'the guide'
      )
    )
    const rows = wrapper.findAll('.abele-github-folder .tree-item-self')
    expect(rows.map((r) => r.attributes('data-path'))).toEqual(['src', 'README.md'])
  })

  it('shows the languages as shares of the whole', async () => {
    const { wrapper } = openTab('https://github.com/o/r', ROUTES)
    await loaded(wrapper)
    await vi.waitFor(() =>
      expect(wrapper.findAll('.abele-github-home__lang-name').map((l) => l.text())).toEqual([
        'TypeScript',
        'CSS',
        'Shell',
      ])
    )
    expect(wrapper.find('.abele-github-home__langs').text()).toContain('70%')
    expect(wrapper.findAll('.abele-github-home__lang-part')).toHaveLength(3)
  })

  it('lists the freshest open pull requests and issues, each opening in a tab', async () => {
    const { wrapper, onOpen } = openTab('https://github.com/o/r', ROUTES)
    await loaded(wrapper)

    const pulls = () => wrapper.findAll('[data-list="pulls"] .tree-item-self')
    await vi.waitFor(() => expect(pulls()).toHaveLength(2))
    expect(pulls()[0].text()).toContain('Page the loader')
    expect(pulls()[0].text()).toContain('#12')
    // A draft says so by its glyph.
    expect(pulls()[1].find('[data-icon="git-pull-request-draft"]').exists()).toBe(true)
    // The issues API lists pull requests too; only the issue is an issue.
    const issues = wrapper.findAll('[data-list="issues"] .tree-item-self')
    expect(issues.map((r) => r.text())).toEqual(['Loader hangs#9'])

    await click(pulls()[0].element)
    expect(onOpen).toHaveBeenLastCalledWith('https://github.com/o/r/pull/12', false)
    await click(issues[0].element, { metaKey: true })
    expect(onOpen).toHaveBeenLastCalledWith('https://github.com/o/r/issues/9', 'tab')
  })

  it('opens every pull request in a list tab from "All"', async () => {
    const { wrapper, onOpen } = openTab('https://github.com/o/r', ROUTES)
    await loaded(wrapper)

    const all = wrapper.find('[data-list="pulls"] .abele-github-home__all')
    await click(all.element)
    expect(onOpen).toHaveBeenLastCalledWith('https://github.com/o/r/pulls', false)
  })

  it('names the latest release', async () => {
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { wrapper } = openTab('https://github.com/o/r', ROUTES)
    await loaded(wrapper)
    await vi.waitFor(() =>
      expect(wrapper.find('[data-list="release"]').text()).toContain('Widgets 2.0')
    )
    expect(wrapper.find('[data-list="release"]').text()).toContain('v2.0.0')
    await click(wrapper.find('[data-list="release"] .tree-item-self').element)
    expect(opened).toHaveBeenCalledWith('https://github.com/o/r/releases/tag/v2.0.0')
  })

  it('leaves out what the repository has none of', async () => {
    const { wrapper } = openTab('https://github.com/o/r', {
      ...ROUTES,
      '/repos/o/r': { json: { ...META, has_issues: false } },
      '/repos/o/r/releases/latest': { status: 404, json: { message: 'Not Found' } },
      '/repos/o/r/pulls': { json: [] },
    })
    await loaded(wrapper)
    await flushPromises()

    expect(wrapper.find('[data-list="issues"]').exists()).toBe(false)
    expect(wrapper.find('[data-list="release"]').exists()).toBe(false)
    expect(wrapper.find('[data-list="pulls"]').text()).toContain('No open pull requests')
  })

  it('keeps the page when one part of it is refused, and says why for that part', async () => {
    const { wrapper } = openTab('https://github.com/o/r', {
      ...ROUTES,
      '/repos/o/r/pulls': {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' },
        json: { message: 'API rate limit exceeded' },
      },
    })
    await loaded(wrapper)
    await flushPromises()

    expect(wrapper.find('[data-list="pulls"]').text()).toMatch(/limit/i)
    expect(wrapper.find('.abele-github-home__about').text()).toContain('Widgets for the dashboard.')
  })

  it('says why when the repository itself is refused', async () => {
    const { wrapper } = openTab('https://github.com/o/r', {
      '/repos/o/r': { status: 404, json: { message: 'Not Found' } },
    })
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.find('.abele-github__error').exists()).toBe(true))
    expect(wrapper.find('.abele-github__error').text()).toContain('o/r')
    expect(wrapper.find('.abele-github-home').exists()).toBe(false)
  })

  it('says a repository with no commits is empty', async () => {
    const { wrapper } = openTab('https://github.com/o/r', {
      ...ROUTES,
      '/repos/o/r/contents': { status: 404, json: { message: 'This repository is empty.' } },
    })
    await loaded(wrapper)
    expect(wrapper.find('.abele-github-home').text()).toContain('This repository is empty')
  })
})

describe('another branch or tag', () => {
  it('a tree link naming only a ref is the front page at that ref', async () => {
    const { wrapper, onTitle, model } = openTab('https://github.com/o/r/tree/dev', ROUTES)
    await loaded(wrapper)

    expect(wrapper.find('.abele-github-crumbs__ref').text()).toBe('dev')
    expect(onTitle).toHaveBeenLastCalledWith('o/r @ dev')
    expect(model.screen.kind).toBe('repo')
    expect(model.screen.link).toEqual({ label: 'o/r@dev', url: 'https://github.com/o/r/tree/dev' })
    const rows = wrapper.findAll('.abele-github-folder .tree-item-self')
    expect(rows.map((r) => r.attributes('data-path'))).toEqual(['DEV.md'])
  })

  it('a tree link into a folder is still the folder', async () => {
    const { wrapper } = openTab('https://github.com/o/r/tree/main/src', {
      ...ROUTES,
      '/repos/o/r/contents/src': { json: [{ name: 'a.ts', path: 'src/a.ts', type: 'file' }] },
    })
    await vi.waitFor(() => expect(wrapper.find('.abele-github-folder').exists()).toBe(true))
    expect(wrapper.find('.abele-github-home').exists()).toBe(false)
  })

  it('offers the switch with the ref shown on it', async () => {
    const { wrapper } = openTab('https://github.com/o/r', ROUTES)
    await loaded(wrapper)
    expect(wrapper.find('.abele-github-home__ref').text()).toContain('main')
  })
})

describe('the file tree', () => {
  it('opens beside the page from the page itself', async () => {
    const { wrapper, model } = openTab('https://github.com/o/r', ROUTES)
    await loaded(wrapper)
    model.tree = false
    await flushPromises()
    await click(wrapper.find('.abele-github-home__files').element)
    expect(model.tree).toBe(true)
  })
})

describe('pinned repositories in the settings', () => {
  it('are listed with their server, and unpinned from there', async () => {
    const config = AbeleConfig.getInstance()
    config.github = {
      ...DEFAULT_GITHUB_SETTINGS,
      enabled: true,
      pinnedRepos: [{ url: 'https://github.com/acme/widgets' }],
    }
    const save = vi.spyOn(config, 'saveSettings').mockResolvedValue()
    const wrapper = mount(GithubSettingsView, { attachTo: document.body })
    await flushPromises()

    const row = wrapper.findAll('.setting-item').find((r) => r.text().includes('acme/widgets'))
    expect(row?.text()).toContain('github.com')
    await click(row!.find('[data-icon="pin-off"]').element.closest('.abele-obsidian-icon')!)
    expect(save).toHaveBeenCalled()
    expect(config.github.pinnedRepos).toEqual([])
    expect(wrapper.text()).toContain('Nothing pinned yet.')
  })
})
