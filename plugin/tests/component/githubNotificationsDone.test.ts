/** Done targets the displayed thread and account, and failures do not look like success. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { GithubClient } from '@/github/client'
import { endpoints } from '@/github/urls'
import GithubNotifications from '@/components/github/GithubNotifications.vue'
import { clientWith, type Reply } from '../helpers/githubTab'

const id = '9007199254740993'
const notification = {
  id,
  unread: true,
  reason: 'review_requested',
  updated_at: '2026-01-02T10:00:00Z',
  subject: {
    title: 'Sample change',
    type: 'PullRequest',
    url: 'https://api.github.com/repos/sample-org/sample-repo/pulls/73',
    latest_comment_url: 'https://api.github.com/repos/sample-org/sample-repo/issues/comments/85',
  },
  repository: { full_name: 'sample-org/sample-repo' },
}
const mounted: ReturnType<typeof mount>[] = []
const setup = (clientFor: () => GithubClient) => {
  const wrapper = mount(GithubNotifications, {
    props: { enabled: true, clientFor, state: reactive({ which: 'all' as const, repo: '' }) },
  })
  mounted.push(wrapper)
  return wrapper
}
const done = async (w: ReturnType<typeof setup>) => {
  await w
    .find(`[data-id="${id}"] .abele-github-notification__mark .abele-obsidian-icon`)
    .trigger('click')
  await flushPromises()
}
const refresh = async (w: ReturnType<typeof setup>) => {
  await (w.vm as unknown as { refresh(force: boolean): Promise<void> }).refresh(true)
  await flushPromises()
}
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount()
  vi.restoreAllMocks()
})

describe('Done refusals', () => {
  const cases: { name: string; reply: Reply; expected: RegExp }[] = [
    {
      name: 'SSO',
      reply: {
        status: 403,
        headers: { 'X-GitHub-SSO': 'required' },
        json: { message: 'SAML enforcement' },
      },
      expected: /single sign-on.*authoris/s,
    },
    {
      name: 'organization policy',
      reply: { status: 403, json: { message: 'OAuth App access restrictions' } },
      expected: /restricts which apps/,
    },
    {
      name: 'missing thread',
      reply: { status: 404, json: { message: 'Not Found' } },
      expected: /thread.*not found|thread.*not accessible/i,
    },
    {
      name: 'validation',
      reply: { status: 422, json: { message: 'Validation Failed' } },
      expected: /Validation Failed/,
    },
    { name: 'unexpected success status', reply: { status: 200 }, expected: /204/ },
  ]
  it.each(cases)(
    'keeps the row and a lasting, actionable error for $name',
    async ({ reply, expected }) => {
      const { client, request } = clientWith({
        '/notifications': { json: [notification] },
        [`/notifications/threads/${id}`]: reply,
      })
      const w = setup(() => client)
      await flushPromises()
      await done(w)
      expect(w.find(`[data-id="${id}"]`).exists()).toBe(true)
      expect(w.find('.abele-github-notice').text()).toMatch(expected)
      expect(w.find('.abele-github-notice').text()).toContain(`Done failed for thread ${id}`)
      expect(w.find('.abele-github-notice').text()).toContain(String(reply.status))
      await refresh(w)
      expect(w.find(`[data-id="${id}"]`).exists()).toBe(true)
      expect(w.find('.abele-github-notice').text()).toMatch(expected)
      expect(request.mock.calls.filter(([r]) => r.method === 'DELETE')).toHaveLength(1)
    }
  )
})

describe('local Done fallback in the panel', () => {
  it('labels unchanged re-listing as local-only and lets the user show the server list', async () => {
    const { client } = clientWith({
      '/notifications': { json: [notification] },
      [`/notifications/threads/${id}`]: { status: 204 },
    })
    const w = setup(() => client)
    await flushPromises()
    await done(w)
    await refresh(w)
    expect(w.find(`[data-id="${id}"]`).exists()).toBe(false)
    const notice = w.find('[role="status"]')
    expect(notice.text()).toContain('GitHub still lists 1 unchanged notification')
    expect(notice.text()).toContain('HTTP 204')
    expect(notice.text()).toContain('Local fallback')
    expect(notice.text()).toContain('session only')
    await notice.find('button').trigger('click')
    await flushPromises()
    expect(w.find(`[data-id="${id}"]`).exists()).toBe(true)
    expect(w.find('[role="status"]').exists()).toBe(false)
  })

  it('does not restore another panel’s Done as a retained read row during polling', async () => {
    const { client } = clientWith({
      '/notifications': { json: [notification] },
      [`/notifications/threads/${id}`]: { status: 204 },
    })
    const first = setup(() => client)
    const second = setup(() => client)
    await flushPromises()
    await done(first)
    await refresh(first)
    await (second.vm as unknown as { refresh(): Promise<void> }).refresh()
    await flushPromises()
    expect(second.find(`[data-id="${id}"]`).exists()).toBe(false)
    expect(second.find('[role="status"]').text()).toContain('Local fallback')
  })

  it('clears a failed Done only after that thread is successfully retried', async () => {
    let status = 403
    const { client } = clientWith({
      '/notifications': { json: [notification] },
      [`/notifications/threads/${id}`]: () => ({ status }),
    })
    const w = setup(() => client)
    await flushPromises()
    await done(w)
    expect(w.find('[role="alert"]').exists()).toBe(true)
    status = 204
    await done(w)
    expect(w.find('[role="alert"]').exists()).toBe(false)
    expect(w.find(`[data-id="${id}"]`).exists()).toBe(false)
  })
})

describe('Done identity', () => {
  it.each([notification.subject, { ...notification.subject, url: null, latest_comment_url: null }])(
    'uses the exact string thread id, never a PR or comment id, for subject %j',
    async (subject) => {
      const { client, request } = clientWith({
        '/notifications': { json: [{ ...notification, subject }] },
        [`/notifications/threads/${id}`]: { status: 204 },
      })
      const w = setup(() => client)
      await flushPromises()
      await done(w)
      expect(request.mock.calls.map(([r]) => [r.method, r.url.split('?')[0]])).toEqual([
        ['GET', 'https://api.github.com/notifications'],
        ['DELETE', `https://api.github.com/notifications/threads/${id}`],
      ])
      expect(w.find(`[data-id="${id}"]`).exists()).toBe(false)
    }
  )

  it.each(['', 'git.example.test'])(
    'keeps the displayed row’s token and server when settings change to %s',
    async (server) => {
      const first = clientWith({
        '/notifications': { json: [notification] },
        [`/notifications/threads/${id}`]: { status: 204 },
      })
      const second = clientWith({ '/notifications': { json: [notification] } })
      const original = new GithubClient(endpoints(''), 'ghp_sample_first', first.request)
      const replacement = new GithubClient(endpoints(server), 'ghp_sample_second', second.request)
      let current = original
      const w = setup(() => current)
      await flushPromises()
      current = replacement
      await done(w)
      expect(second.request).not.toHaveBeenCalled()
      expect(first.request.mock.calls.map(([r]) => r.method)).toEqual(['GET', 'DELETE'])
      expect(
        first.request.mock.calls.every(
          ([r]) => r.headers?.Authorization === 'Bearer ghp_sample_first'
        )
      ).toBe(true)
      expect(w.find(`[data-id="${id}"]`).exists()).toBe(false)
    }
  )
})
