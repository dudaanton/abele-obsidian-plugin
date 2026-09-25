/**
 * "Check access" in the GitHub settings, against a scripted `requestUrl`.
 *
 * Asking `/user` proves only that a token exists. What a person with a refused repository needs
 * is each permission tried against that repository, one row each, saying which one GitHub
 * refused and why — and whether the token was sent at all, since a token that never left the
 * keychain looks exactly like a token with no access.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'
import { requestUrl } from 'obsidian'
import GithubSettings from '@/components/settings/GithubSettings.vue'
import Button from '@/components/obsidian/Button.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GITHUB_TOKEN_KEY_ID, DEFAULT_GITHUB_SETTINGS } from '@/github/settings'
import { resetGithubClients } from '@/github/GithubService'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestUrl: vi.fn(),
}))

const TOKEN = 'github_pat_SECRETVALUE0123456789' // made up — repo-guard: allow

type Reply = { status?: number; json?: unknown; headers?: Record<string, string> }

let app: FakeApp
let calls: RequestUrlParam[]

function answer(routes: Record<string, Reply>) {
  calls = []
  vi.mocked(requestUrl).mockImplementation((async (req: RequestUrlParam) => {
    calls.push(req)
    const path = req.url.replace('https://api.github.com', '')
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => path.startsWith(k))
    const r: Reply = key ? routes[key] : { status: 404, json: { message: 'Not Found' } }
    return {
      status: r.status ?? 200,
      headers: r.headers ?? {},
      json: r.json ?? {},
      text: JSON.stringify(r.json ?? {}),
      arrayBuffer: new ArrayBuffer(0),
    } as RequestUrlResponse
  }) as never)
}

const REFUSED = {
  status: 403,
  json: { message: 'Resource not accessible by personal access token' },
}

const open = () => mount(GithubSettings, { attachTo: document.body })

async function check(wrapper: ReturnType<typeof open>, repo = '') {
  if (repo)
    await wrapper
      .find('.abele-github-settings__repo input, input.abele-github-settings__repo')
      .setValue(repo)
  const button = wrapper.findAllComponents(Button).find((b) => b.props('text') === 'Check')!
  await button.trigger('click')
  await flushPromises()
}

const rows = (wrapper: ReturnType<typeof open>) =>
  wrapper.findAll('.abele-github-access .abele-card').map((c) => c.text())

beforeEach(() => {
  app = useVault([])
  resetGithubClients()
  AbeleConfig.getInstance().github = {
    ...DEFAULT_GITHUB_SETTINGS,
    enabled: true,
    keyId: GITHUB_TOKEN_KEY_ID,
  }
  app.secretStorage.setSecret(GITHUB_TOKEN_KEY_ID, TOKEN)
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})

describe('check access', () => {
  it('without a repository says whose token it is, that it was sent and where', async () => {
    answer({
      '/user': {
        json: { login: 'anton' },
        headers: { 'github-authentication-token-expiration': '2026-12-01 10:00:00 UTC' },
      },
    })
    const wrapper = open()
    await check(wrapper)
    const text = wrapper.find('.abele-github-access').text()
    expect(text).toContain('anton')
    expect(text).toContain('fine-grained')
    expect(text).toContain(`${TOKEN.length} characters`)
    expect(text).toContain('2026-12-01')
    expect(text).toContain('https://api.github.com')
    expect(calls).toHaveLength(1)
  })

  it('with a repository tries every permission and says which was refused and why', async () => {
    answer({
      '/user': { json: { login: 'anton' } },
      '/repos/acme/app/contents': { json: [] },
      '/repos/acme/app/issues': { json: [] },
      '/repos/acme/app/pulls': {
        ...REFUSED,
        headers: { 'x-accepted-github-permissions': 'pull_requests=read' },
      },
      '/repos/acme/app': { json: { full_name: 'acme/app' } },
      '/graphql': {
        json: {
          data: { repository: { hasDiscussionsEnabled: true, discussions: { totalCount: 2 } } },
        },
      },
    })
    const wrapper = open()
    await check(wrapper, 'https://github.com/acme/app/pull/12/files')

    const all = rows(wrapper)
    const row = (name: string) => all.find((t) => t.startsWith(name))!
    expect(row('Metadata')).toContain('OK')
    expect(row('Contents')).toContain('OK')
    expect(row('Issues')).toContain('OK')
    expect(row('Discussions')).toContain('OK')

    const pulls = row('Pull requests')
    expect(pulls).toContain('Refused')
    expect(pulls).toContain('403')
    expect(pulls).toMatch(/Resource owner/)
    expect(pulls).toContain('Needs: Pull requests (read)')
    expect(pulls).toContain('GitHub said: "Resource not accessible by personal access token"')

    expect(calls.map((c) => c.url)).toEqual(
      expect.arrayContaining([
        'https://api.github.com/repos/acme/app',
        'https://api.github.com/repos/acme/app/issues?per_page=1',
        'https://api.github.com/repos/acme/app/pulls?per_page=1',
      ])
    )
  })

  it('a private repository the token cannot see: not found, with the resource-owner hint', async () => {
    answer({ '/user': { json: { login: 'anton' } } })
    const wrapper = open()
    await check(wrapper, 'acme/secret')
    const metadata = rows(wrapper).find((t) => t.startsWith('Metadata'))!
    expect(metadata).toContain('404')
    expect(metadata).toMatch(/Resource owner is the organisation/)
  })

  it('never shows the token itself', async () => {
    answer({ '/user': { json: { login: 'anton' } } })
    const wrapper = open()
    await check(wrapper, 'acme/app')
    expect(wrapper.html()).not.toContain('SECRETVALUE')
  })

  it('says plainly when no token was sent', async () => {
    app.secretStorage.setSecret(GITHUB_TOKEN_KEY_ID, '')
    answer({ '/rate_limit': { json: { rate: { remaining: 59, limit: 60 } } } })
    const wrapper = open()
    await check(wrapper, 'obsidianmd/obsidian-api')
    const text = wrapper.find('.abele-github-access').text()
    expect(text).toContain('No token was sent')
    expect(calls.every((c) => !c.headers?.Authorization)).toBe(true)
    // Discussions are only served to a signed-in request, so the row is skipped, not refused.
    expect(rows(wrapper).find((t) => t.startsWith('Discussions'))).toContain('Skipped')
  })

  it('a github.com link while an Enterprise server is set is read without the token, and says so', async () => {
    AbeleConfig.getInstance().github = {
      ...AbeleConfig.getInstance().github!,
      server: 'https://github.example.com',
    }
    answer({ '/rate_limit': { json: { rate: { remaining: 59, limit: 60 } } } })
    const wrapper = open()
    await check(wrapper, 'https://github.com/acme/app')
    const text = wrapper.find('.abele-github-access').text()
    expect(text).toContain('No token was sent')
    expect(text).toContain('Token is set for: github.example.com')
    expect(text).toContain('Repository: acme/app on github.com')
    expect(text).toContain('API: https://api.github.com')
  })

  it('a link to the Enterprise server itself goes there, with the token', async () => {
    AbeleConfig.getInstance().github = {
      ...AbeleConfig.getInstance().github!,
      server: 'https://GitHub.Example.com/api/v3/',
    }
    answer({})
    const wrapper = open()
    await check(wrapper, 'https://www.github.example.com/acme/app/pull/3')
    const text = wrapper.find('.abele-github-access').text()
    expect(text).toContain('Sent with every request')
    expect(text).toContain('API: https://github.example.com/api/v3')
    expect(calls[0].url.startsWith('https://github.example.com/api/v3/')).toBe(true)
    expect(calls[0].headers?.Authorization).toBe(`Bearer ${TOKEN}`)
  })
})
