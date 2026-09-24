/**
 * The "Open on GitHub" picker around its search: which repository it means, that GitHub is asked
 * only once typing pauses and only for what is still in the field, and what a choice opens.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { App, RequestUrlParam, RequestUrlResponse } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_GITHUB_SETTINGS } from '@/github/settings'
import { GithubClient } from '@/github/client'
import { endpoints } from '@/github/urls'
import { OpenSearch } from '@/github/open/search'
import { OpenPicker, DEBOUNCE_MS, forgetLastPicked, pickerRepo } from '@/github/open/OpenPicker'
import * as service from '@/github/GithubService'
import { GITHUB_VIEW_TYPE } from '@/github/GithubService'
import { useVault } from '../helpers/testEnv'

const R = '/repos/octo-org/octo-repo'

function client(routes: Record<string, unknown>) {
  const calls: string[] = []
  const request = vi.fn(async (req: RequestUrlParam) => {
    calls.push(decodeURIComponent(req.url.replace('https://api.github.com', '')))
    const path = calls[calls.length - 1]
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => path.startsWith(k))
    const json = key ? routes[key] : { message: 'Not Found' }
    return {
      status: key ? 200 : 404,
      headers: {},
      json,
      text: JSON.stringify(json),
      arrayBuffer: new ArrayBuffer(0),
    } as RequestUrlResponse
  })
  return { client: new GithubClient(endpoints(''), '', request), calls }
}

const githubLeaf = (url: string) => ({
  view: {
    getViewType: () => GITHUB_VIEW_TYPE,
    model: { target: service.parseForSettings(url) },
  },
})

function app(mostRecent: unknown = null): App {
  return { workspace: { getMostRecentLeaf: () => mostRecent } } as unknown as App
}

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().github = { ...DEFAULT_GITHUB_SETTINGS, enabled: true }
  forgetLastPicked()
  service.noteActiveLeaf(null)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the repository a bare number means', () => {
  it('is the one the active GitHub tab shows', () => {
    const leaf = githubLeaf('https://github.com/octo-org/octo-repo/pull/1')
    expect(pickerRepo(app(leaf))).toEqual({
      host: 'github.com',
      owner: 'octo-org',
      repo: 'octo-repo',
    })
  })

  it('else the default repository from the settings', () => {
    AbeleConfig.getInstance().github = {
      ...DEFAULT_GITHUB_SETTINGS,
      enabled: true,
      defaultRepo: 'https://github.com/octo-org/other',
    }
    expect(pickerRepo(app())).toMatchObject({ owner: 'octo-org', repo: 'other' })
  })

  it('is the GitHub tab used last only while that tab is still open', () => {
    const leaf = githubLeaf('https://github.com/octo-org/used/issues/1')
    service.noteActiveLeaf(leaf as never)
    const withTabs = (leaves: unknown[]) =>
      ({
        workspace: { getMostRecentLeaf: () => null, getLeavesOfType: () => leaves },
      }) as unknown as App
    expect(pickerRepo(withTabs([leaf]))).toMatchObject({ repo: 'used' })
    expect(pickerRepo(withTabs([]))).toBeNull()
  })

  it('else none', () => {
    expect(pickerRepo(app())).toBeNull()
  })

  it('once something was opened from the picker, is that one — before the setting', async () => {
    AbeleConfig.getInstance().github = {
      ...DEFAULT_GITHUB_SETTINGS,
      enabled: true,
      defaultRepo: 'octo-org/other',
    }
    vi.spyOn(service, 'openGithubUrl').mockResolvedValue(true)
    const picker = new OpenPicker(app())
    await picker.choose(
      {
        kind: 'issue',
        title: 'x',
        url: 'https://github.com/octo-org/octo-repo/issues/1',
        repo: { host: 'github.com', owner: 'octo-org', repo: 'octo-repo' },
      },
      false
    )
    expect(pickerRepo(app())).toMatchObject({ repo: 'octo-repo' })
  })
})

describe('typing', () => {
  it('asks GitHub only once it pauses, and only for what is still in the field', async () => {
    vi.useFakeTimers()
    const { client: c, calls } = client({
      [`${R}/issues/12`]: { number: 12, title: 'Fix', state: 'open' },
      [`${R}/issues/1`]: { number: 1, title: 'One', state: 'open' },
    })
    const leaf = githubLeaf('https://github.com/octo-org/octo-repo/issues/5')
    const picker = new OpenPicker(app(leaf), '', new OpenSearch(() => c))
    const refreshed = vi.fn()
    picker.inputEl.addEventListener('input', refreshed)

    picker.inputEl.value = '#1'
    picker.getSuggestions('#1')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS / 2)
    picker.inputEl.value = '#12'
    const first = picker.getSuggestions('#12')
    expect(first[0].title).toBe('#12')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(calls).toEqual([`${R}/issues/12`])
    expect(refreshed).toHaveBeenCalledTimes(1)
    expect(picker.getSuggestions('#12')[0].title).toBe('Fix')
  })

  it('an answer for an input no longer there does not redraw the list', async () => {
    vi.useFakeTimers()
    const { client: c } = client({
      [`${R}/issues/12`]: { number: 12, title: 'Fix', state: 'open' },
    })
    const leaf = githubLeaf('https://github.com/octo-org/octo-repo/issues/5')
    const picker = new OpenPicker(app(leaf), '', new OpenSearch(() => c))
    const refreshed = vi.fn()
    picker.inputEl.addEventListener('input', refreshed)

    picker.inputEl.value = '#12'
    picker.getSuggestions('#12')
    picker.inputEl.value = '#12 and more'
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(refreshed).not.toHaveBeenCalled()
  })

  it('puts the reason there is nothing in the empty state', () => {
    const picker = new OpenPicker(app(), '', new OpenSearch(() => client({}).client))
    expect(picker.getSuggestions('#3')).toEqual([])
    expect(picker.emptyStateText).toMatch(/which repository/)
  })
})

describe('choosing', () => {
  it('opens the row’s address, in a new tab with Mod', async () => {
    const open = vi.spyOn(service, 'openGithubUrl').mockResolvedValue(true)
    const picker = new OpenPicker(app(), '', new OpenSearch(() => client({}).client))
    const row = { kind: 'pull' as const, title: 'x', url: 'https://github.com/o/r/pull/2' }
    picker.onChooseSuggestion(row, new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }))
    await Promise.resolve()
    expect(open).toHaveBeenCalledWith(expect.anything(), row.url, 'tab')
  })

  it('asks GitHub first for a row that has no address yet', async () => {
    const open = vi.spyOn(service, 'openGithubUrl').mockResolvedValue(true)
    const picker = new OpenPicker(app(), '', new OpenSearch(() => client({}).client))
    await picker.choose(
      { kind: 'issue', title: '#1', resolve: async () => 'https://github.com/o/r/discussions/1' },
      false
    )
    expect(open).toHaveBeenCalledWith(
      expect.anything(),
      'https://github.com/o/r/discussions/1',
      false
    )
  })

  it('a line that only says something keeps the picker open', () => {
    const picker = new OpenPicker(app(), '', new OpenSearch(() => client({}).client))
    const close = vi.spyOn(picker, 'close')
    picker.selectSuggestion({ kind: 'note', title: 'Asking GitHub…' }, new MouseEvent('click'))
    expect(close).not.toHaveBeenCalled()
  })
})
