/**
 * People in a GitHub tab: shown by the name on their profile with their picture, or by login as
 * the settings say — and the other one always reachable on the spot, by tooltip and by a click.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { RequestUrlParam } from 'obsidian'
import { ISSUE, PULL, openTab, type Route } from '../helpers/githubTab'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_GITHUB_SETTINGS } from '@/github/settings'
import { GithubUsers, githubUsers, setGithubUsers } from '@/github/users'
import GithubSettings from '@/components/settings/GithubSettings.vue'
import Button from '@/components/obsidian/Button.vue'

const NAMES: Record<string, string | null> = { bob: 'Bob Example', ann: 'Ann Example', eve: null }

/** The batched `user(login:)` query, answered from `NAMES`. */
const graphql: Route = (req: RequestUrlParam) => {
  const { variables } = JSON.parse(String(req.body)) as { variables: Record<string, string> }
  const data = Object.fromEntries(
    Object.entries(variables).map(([v, login]) => [
      `u${v.slice(1)}`,
      { login, name: NAMES[login] ?? null, avatarUrl: `https://avatars.example.com/${login}` },
    ])
  )
  return { json: { data } }
}

const setDisplay = (userDisplay: 'name' | 'login') => {
  const config = AbeleConfig.getInstance()
  config.github = { ...DEFAULT_GITHUB_SETTINGS, enabled: true, userDisplay }
  config.version.value++
}

const openIssue = () =>
  openTab('https://github.com/o/r/issues/5', {
    '/repos/o/r/issues/5': {
      json: {
        ...ISSUE,
        user: { login: 'bob', avatar_url: 'https://avatars.example.com/u/2?v=4' },
      },
    },
    '/repos/o/r/issues/5/comments': {
      json: [
        { id: 9, user: { login: 'ann' }, body: 'Same here', created_at: '2026-01-02' },
        { id: 10, user: { login: 'eve' }, body: 'And me', created_at: '2026-01-03' },
      ],
    },
    '/graphql': graphql,
  })

/** Waits for the names to come back and be drawn. */
const settled = async () => {
  await vi.waitFor(() => expect(githubUsers().nameOf('github.com', 'bob')).toBe('Bob Example'))
  await flushPromises()
}

beforeEach(() => {
  useVault([])
  document.body.replaceChildren()
  setGithubUsers(new GithubUsers())
  setDisplay('name')
})

describe('a person in a tab', () => {
  it('is shown by name, with the login in the tooltip', async () => {
    const { wrapper, request } = openIssue()
    await flushPromises()
    await settled()

    const authors = wrapper.findAll('.abele-github-comment__author')
    expect(authors.map((a) => a.text())).toEqual(['Bob Example', 'Ann Example', 'eve'])
    expect(authors[0].attributes('aria-label')).toBe('Bob Example · bob')
    // The details under the title name the author too.
    expect(wrapper.find('.abele-github-header__meta').text()).toContain('Bob Example opened')
    // Three people, one question.
    expect(request.mock.calls.filter(([r]) => r.url.endsWith('/graphql'))).toHaveLength(1)
  })

  it('draws the picture the answer named until one is kept', async () => {
    const { wrapper } = openIssue()
    await flushPromises()

    const img = wrapper.find('.abele-github-comment__author .abele-avatar__image')
    expect(img.attributes('src')).toBe('https://avatars.example.com/u/2?v=4&s=40')
  })

  it('swaps to the login and back with a click, in that place only', async () => {
    const { wrapper } = openIssue()
    await flushPromises()
    await settled()

    const first = wrapper.findAll('.abele-github-comment__author')[0]
    await first.trigger('click')
    expect(first.text()).toBe('bob')
    expect(wrapper.find('.abele-github-header__meta').text()).toContain('Bob Example opened')
    await first.trigger('click')
    expect(first.text()).toBe('Bob Example')
  })

  it('is shown by login when the settings say so, the name one click away', async () => {
    setDisplay('login')
    const { wrapper } = openIssue()
    await flushPromises()
    await settled()

    const authors = wrapper.findAll('.abele-github-comment__author')
    expect(authors.map((a) => a.text())).toEqual(['bob', 'ann', 'eve'])
    await authors[1].trigger('click')
    expect(authors[1].text()).toBe('Ann Example')
  })

  it('follows the setting at once, without reopening the tab', async () => {
    const { wrapper } = openIssue()
    await flushPromises()
    await settled()

    setDisplay('login')
    await flushPromises()
    expect(wrapper.findAll('.abele-github-comment__author')[0].text()).toBe('bob')
  })

  it('in a pull request’s commits: the account’s name, or git’s name when there is none', async () => {
    const { wrapper } = openTab('https://github.com/o/r/pull/7/commits', {
      '/repos/o/r/pulls/7': { json: PULL },
      '/repos/o/r/issues/7/comments': { json: [] },
      '/repos/o/r/pulls/7/reviews': { json: [] },
      '/repos/o/r/pulls/7/commits': {
        json: [
          {
            sha: 'a'.repeat(40),
            commit: { message: 'One', author: { name: 'b', date: '2026-01-01' } },
            author: { login: 'bob' },
          },
          {
            sha: 'b'.repeat(40),
            commit: { message: 'Two', author: { name: 'Offline Person', date: '2026-01-01' } },
            author: null,
          },
        ],
      },
      '/graphql': graphql,
    })
    await flushPromises()
    await settled()

    const subtitles = wrapper.findAll('.abele-github__commits .abele-card__subtitle')
    expect(subtitles[0].text()).toContain('Bob Example')
    expect(subtitles[1].text()).toContain('Offline Person')
    // The name is the person's to swap; the card does not open the commit for it.
    await subtitles[0].find('.abele-github-user').trigger('click')
    expect(subtitles[0].text()).toContain('bob')
  })
})

describe('the GitHub settings', () => {
  const open = () => mount(GithubSettings, { attachTo: document.body })

  beforeEach(() => {
    vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  })

  it('choose what people are shown by', async () => {
    const wrapper = open()
    const select = wrapper.find('.abele-settings__github select')
    await select.setValue('login')
    expect(AbeleConfig.getInstance().github.userDisplay).toBe('login')
  })

  it('clear the kept names and pictures', async () => {
    const { wrapper: tab } = openIssue()
    await flushPromises()
    await settled()
    expect(githubUsers().size).toBe(3)

    const wrapper = open()
    await flushPromises()
    expect(wrapper.text()).toContain('3 people are kept on this device')
    const clear = wrapper.findAllComponents(Button).find((b) => b.props('text') === 'Clear')!
    await clear.trigger('click')
    await flushPromises()

    expect(githubUsers().size).toBe(0)
    expect(wrapper.text()).toContain('None kept on this device yet')
    tab.unmount()
  })
})
