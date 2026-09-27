/**
 * "Open GitHub repository…": what it offers — pinned, recent on this device, your own, starred,
 * found — once each and in that order, narrowed by what is typed; where pins and recent ones are
 * kept; that the account's lists are asked for once an hour; and what a choice opens.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { App, RequestUrlParam, RequestUrlResponse } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_GITHUB_SETTINGS, githubSettingsFrom } from '@/github/settings'
import { GithubClient } from '@/github/client'
import { endpoints } from '@/github/urls'
import * as service from '@/github/GithubService'
import {
  ACCOUNT_TTL_MS,
  RECENT_KEY,
  accountRepos,
  isPinned,
  pinnedRepos,
  recentRepos,
  rememberRepo,
  repoFromUrl,
  repoRows,
  setPinned,
  type RepoEntry,
} from '@/github/open/repoList'
import { RepoPicker } from '@/github/open/RepoPicker'
import { useVault } from '../helpers/testEnv'

const e = (owner: string, repo: string, extra: Partial<RepoEntry> = {}): RepoEntry => ({
  host: 'github.com',
  owner,
  repo,
  ...extra,
})

function storage() {
  const kept = new Map<string, unknown>()
  return {
    loadLocalStorage: (k: string) => kept.get(k) ?? null,
    saveLocalStorage: (k: string, v: unknown) => void kept.set(k, v),
    kept,
  }
}

function client(routes: Record<string, unknown>, token = 'tkn') {
  const calls: string[] = []
  const request = vi.fn(async (req: RequestUrlParam) => {
    const path = decodeURIComponent(req.url.replace('https://api.github.com', ''))
    calls.push(path)
    const key = Object.keys(routes).find((k) => path.startsWith(k))
    const json = key ? routes[key] : { message: 'Not Found' }
    return {
      status: key ? 200 : 404,
      headers: {},
      json,
      text: JSON.stringify(json),
      arrayBuffer: new ArrayBuffer(0),
    } as RequestUrlResponse
  })
  return { client: new GithubClient(endpoints(''), token, request), calls }
}

const raw = (owner: string, name: string, extra: object = {}) => ({
  name,
  owner: { login: owner },
  ...extra,
})

beforeEach(() => {
  useVault([])
  const config = AbeleConfig.getInstance()
  config.github = { ...DEFAULT_GITHUB_SETTINGS, enabled: true }
  vi.spyOn(config, 'saveSettings').mockResolvedValue()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the rows', () => {
  it('are each repository once, pinned before recent before yours before starred', () => {
    const rows = repoRows(
      {
        pinned: [e('a', 'pinned')],
        recent: [e('a', 'recent'), e('a', 'pinned')],
        own: [e('a', 'own'), e('a', 'recent')],
        starred: [e('b', 'starred'), e('a', 'own')],
      },
      ''
    )
    expect(rows.map((r) => [r.group, r.title])).toEqual([
      ['pinned', 'a/pinned'],
      ['recent', 'a/recent'],
      ['own', 'a/own'],
      ['starred', 'b/starred'],
    ])
  })

  it('narrow to the typed text, the closest names first', () => {
    const rows = repoRows(
      {
        own: [
          e('acme', 'dashboard', { description: 'Widgets live here' }),
          e('acme', 'widgets-old'),
          e('acme', 'widgets'),
        ],
        starred: [e('other', 'mywidgets')],
      },
      'widgets'
    )
    expect(rows.map((r) => r.title)).toEqual([
      'acme/widgets',
      'acme/widgets-old',
      'other/mywidgets',
      'acme/dashboard',
    ])
  })

  it('say where each came from and what it is', () => {
    const [row] = repoRows({ own: [e('a', 'b', { private: true, description: 'Code' })] }, '')
    expect(row.note).toBe('Yours · private · Code')
  })
})

describe('pinned repositories', () => {
  it('are kept in the settings by their address, and saved', async () => {
    const repo = { host: 'github.com', owner: 'acme', repo: 'widgets' }
    await setPinned(repo, true)
    expect(AbeleConfig.getInstance().github.pinnedRepos).toEqual([
      { url: 'https://github.com/acme/widgets' },
    ])
    expect(AbeleConfig.getInstance().saveSettings).toHaveBeenCalled()
    expect(isPinned({ ...repo, owner: 'ACME' })).toBe(true)
    expect(pinnedRepos()).toEqual([repo])

    await setPinned(repo, false)
    expect(AbeleConfig.getInstance().github.pinnedRepos).toEqual([])
  })

  it('an unreadable one in a hand-edited file is dropped, not a crash', () => {
    const read = githubSettingsFrom({ pinnedRepos: [{ url: 1 }, null, { url: 'x' }] } as never)
    expect(read.pinnedRepos).toEqual([{ url: 'x' }])
    expect(repoFromUrl('x')).toBeNull()
  })
})

describe('recent repositories', () => {
  it('are this device’s, the latest first, each once', () => {
    const app = storage()
    rememberRepo(app, { host: 'github.com', owner: 'a', repo: 'one' })
    rememberRepo(app, { host: 'github.com', owner: 'a', repo: 'two' })
    rememberRepo(app, { host: 'github.com', owner: 'a', repo: 'one' })
    expect(app.kept.get(RECENT_KEY)).toEqual([
      'https://github.com/a/one',
      'https://github.com/a/two',
    ])
    expect(recentRepos(app).map((r) => r.repo)).toEqual(['one', 'two'])
  })

  it('are remembered whenever something of the repository is opened', async () => {
    const app = {
      ...storage(),
      workspace: {
        getLeavesOfType: () => [],
        getLeaf: () => ({ setViewState: vi.fn(async () => {}) }),
        revealLeaf: vi.fn(async () => {}),
      },
    }
    await service.openGithubUrl(app as unknown as App, 'https://github.com/acme/widgets/pull/3')
    expect(recentRepos(app).map((r) => `${r.owner}/${r.repo}`)).toEqual(['acme/widgets'])
  })
})

describe("the account's own and starred", () => {
  it('are asked once, and again after an hour', async () => {
    const { client: c, calls } = client({
      '/user/repos': [raw('me', 'mine', { private: true })],
      '/user/starred': [raw('them', 'liked')],
    })
    const lists = await accountRepos(c, 1000)
    expect(lists.own).toEqual([
      expect.objectContaining({ owner: 'me', repo: 'mine', private: true }),
    ])
    expect(lists.starred.map((r) => r.repo)).toEqual(['liked'])
    await accountRepos(c, 2000)
    expect(calls.filter((p) => p.startsWith('/user/repos'))).toHaveLength(1)
    await accountRepos(c, 1000 + ACCOUNT_TTL_MS + 1)
    expect(calls.filter((p) => p.startsWith('/user/repos'))).toHaveLength(2)
  })
})

describe('the picker', () => {
  const app = () => ({ ...storage(), workspace: { getLeavesOfType: () => [] } }) as unknown as App

  it('offers pinned, recent, yours and starred once GitHub has answered', async () => {
    await setPinned({ host: 'github.com', owner: 'p', repo: 'pinned' }, true)
    const a = app()
    rememberRepo(a, { host: 'github.com', owner: 'r', repo: 'recent' })
    const { client: c } = client({
      '/user/repos': [raw('me', 'mine')],
      '/user/starred': [raw('them', 'liked')],
    })
    const picker = new RepoPicker(a, c)
    picker.onOpen()
    await vi.waitFor(() =>
      expect(picker.getSuggestions('').map((r) => r.title)).toEqual([
        'p/pinned',
        'r/recent',
        'me/mine',
        'them/liked',
      ])
    )
  })

  it('without a token says why yours and starred are missing, and asks GitHub nothing for them', () => {
    const { client: c, calls } = client({}, '')
    const picker = new RepoPicker(app(), c)
    picker.onOpen()
    const rows = picker.getSuggestions('')
    expect(rows.at(-1)).toMatchObject({ group: 'note', title: expect.stringMatching(/token/) })
    expect(calls).toEqual([])
  })

  it('offers owner/repo typed whole, and searches GitHub once the typing pauses', async () => {
    vi.useFakeTimers()
    const { client: c, calls } = client(
      { '/search/repositories': { items: [raw('acme', 'widgets-extra')] } },
      ''
    )
    const picker = new RepoPicker(app(), c)
    picker.onOpen()
    expect(picker.getSuggestions('acme/widgets').map((r) => r.title)).toEqual(['acme/widgets'])
    await vi.advanceTimersByTimeAsync(400)
    expect(calls.filter((p) => p.startsWith('/search/repositories'))).toHaveLength(1)
    expect(picker.getSuggestions('acme/widgets').map((r) => r.title)).toEqual([
      'acme/widgets',
      'acme/widgets-extra',
    ])
  })

  it('opens the front page of what is chosen, Mod in a new tab', async () => {
    const open = vi.spyOn(service, 'openGithubUrl').mockResolvedValue(true)
    const { client: c } = client({}, '')
    const picker = new RepoPicker(app(), c)
    const [row] = repoRows({ own: [e('acme', 'widgets')] }, '')
    picker.onChooseSuggestion(row, new MouseEvent('click', { metaKey: true }))
    await Promise.resolve()
    expect(open).toHaveBeenCalledWith(expect.anything(), 'https://github.com/acme/widgets', 'tab')
  })
})
