/** The inbox mirrors GitHub's read and unread list; Done is not Mark read. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { WorkspaceLeaf, type RequestUrlParam } from 'obsidian'
import GithubNotifications from '@/components/github/GithubNotifications.vue'
import Icon from '@/components/obsidian/Icon.vue'
import { NotificationsView } from '@/github/notifications/NotificationsView'
import { inboxFor, type NotificationsState } from '@/github/notifications/inbox'
import { clientWith, type Route } from '../helpers/githubTab'

const notes = [
  { id: '11', unread: true, updated_at: '2026-01-02T10:00:00Z' },
  { id: '12', unread: false, updated_at: '2026-01-01T10:00:00Z' },
].map((n) => ({
  ...n,
  reason: 'mention',
  subject: { title: `Sample thread ${n.id}`, type: 'Issue', url: null, latest_comment_url: null },
  repository: { full_name: 'sample-org/sample-repo' },
}))
const mounted: ReturnType<typeof mount>[] = []

function panel(routes: Record<string, Route>, which: NotificationsState['which'] = 'all') {
  const { client, request } = clientWith(routes)
  const state = reactive<NotificationsState>({ which, repo: '' })
  const onOpen = vi.fn()
  const wrapper = mount(GithubNotifications, {
    props: { enabled: true, clientFor: () => client, state, onOpen },
  })
  mounted.push(wrapper)
  return { wrapper, request, client, state, onOpen }
}
const ids = (w: ReturnType<typeof panel>['wrapper']) =>
  w.findAll('.abele-github-notification').map((r) => r.attributes('data-id'))
const refresh = (w: ReturnType<typeof panel>['wrapper'], force = false) =>
  (w.vm as unknown as { refresh(force: boolean): Promise<void> }).refresh(force)

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount()
  vi.restoreAllMocks()
})

describe('the inbox default', () => {
  it('shows read notifications on a new panel and migrates the old unread default once', async () => {
    const view = new NotificationsView(new WorkspaceLeaf())
    expect(view.state.which).toBe('all')
    await view.setState({ which: 'unread', repo: 'sample-org/sample-repo' }, {} as never)
    expect(view.state).toEqual({ which: 'all', repo: 'sample-org/sample-repo' })
    // A deliberate choice of Unread in the new inbox survives layout restoration.
    view.state.which = 'unread'
    const restored = new NotificationsView(new WorkspaceLeaf())
    await restored.setState(view.getState(), {} as never)
    expect(restored.state.which).toBe('unread')
  })
})

describe('Done', () => {
  it.each(['11', '12'])(
    'offers Done on thread %s, read or unread, and removes it without opening',
    async (id) => {
      let current = [...notes]
      const { wrapper, request, client, onOpen } = panel({
        '/notifications': () => ({ json: current }),
        [`/notifications/threads/${id}`]: (req: RequestUrlParam) => {
          if (req.method === 'DELETE') {
            current = current.filter((n) => n.id !== id)
            return { status: 204 }
          }
          return { status: 205 }
        },
      })
      await flushPromises()
      const check = wrapper.find(`[data-id="${id}"] .abele-github-notification__mark`)
      expect(check.exists()).toBe(true)
      expect(check.findComponent(Icon).props('tooltip')).toBe('Done on GitHub (remove from inbox)')
      await check.findComponent(Icon).trigger('click')
      await flushPromises()
      expect(request.mock.calls.filter(([r]) => r.method === 'DELETE').map(([r]) => r.url)).toEqual(
        [`https://api.github.com/notifications/threads/${id}`]
      )
      expect(request.mock.calls.filter(([r]) => r.method === 'PATCH')).toEqual([])
      expect(onOpen).not.toHaveBeenCalled()
      expect(ids(wrapper)).toEqual(notes.filter((n) => n.id !== id).map((n) => n.id))
      expect(
        inboxFor(client)
          .cached('all')
          ?.some((n) => n.id === id)
      ).toBe(false)
      await refresh(wrapper, true)
      expect(ids(wrapper)).not.toContain(id)
    }
  )

  it('keeps a refused Done in the cache and shows the refusal instead of pretending success', async () => {
    const { wrapper, client } = panel({
      '/notifications': { json: notes },
      '/notifications/threads/11': { status: 403, json: { message: 'Forbidden' } },
    })
    await flushPromises()
    await wrapper
      .find('[data-id="11"] .abele-github-notification__mark .abele-obsidian-icon')
      .trigger('click')
    await flushPromises()
    expect(wrapper.find('.abele-github-notice').exists()).toBe(true)
    expect(
      inboxFor(client)
        .cached('all')
        ?.map((n) => n.id)
    ).toEqual(['11', '12'])
  })
})

describe('polling and bulk read', () => {
  it('retains a row read elsewhere during polling, but refresh shows the current unread list', async () => {
    let now = Date.parse('2026-01-03T10:00:00Z')
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    let current = [notes[0]]
    const { wrapper } = panel({ '/notifications': () => ({ json: current }) }, 'unread')
    await flushPromises()
    current = []
    now += 61_000
    await refresh(wrapper)
    expect(ids(wrapper)).toEqual(['11'])
    expect(wrapper.find('[data-id="11"]').classes()).not.toContain('is-unread')
    await refresh(wrapper, true)
    expect(ids(wrapper)).toEqual([])
  })

  it('marks all read, not done, and tells the difference in the tooltip', async () => {
    const { wrapper, request } = panel({
      '/notifications': (req: RequestUrlParam) =>
        req.method === 'PUT' ? { status: 205 } : { json: notes },
    })
    await flushPromises()
    const all = wrapper.findComponent('.abele-github-notifications__read-all')
    expect(all.props('tooltip')).toContain('keep in inbox')
    await all.trigger('click')
    await flushPromises()
    expect(request.mock.calls.filter(([r]) => r.method === 'DELETE')).toEqual([])
    expect(request.mock.calls.filter(([r]) => r.method === 'PUT')).toHaveLength(1)
    expect(ids(wrapper)).toEqual(['11', '12'])
    expect(wrapper.findAll('.is-unread')).toHaveLength(0)
  })
})

describe('refresh and write ordering', () => {
  it('disables Done while a refresh is in flight, then permits it on the refreshed row', async () => {
    const { wrapper, client, request } = panel({
      '/notifications': { json: notes },
      '/notifications/threads/11': { status: 204 },
    })
    await flushPromises()
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(client, 'call').mockImplementationOnce(async () => {
      await waiting
      return { status: 200, headers: {}, body: notes } as never
    })
    const loading = refresh(wrapper, true)
    await flushPromises()
    const check = wrapper
      .find('[data-id="11"] .abele-github-notification__mark')
      .findComponent(Icon)
    await check.trigger('click')
    await flushPromises()
    const during = request.mock.calls.filter(([r]) => r.method === 'DELETE').length
    release()
    await loading
    await flushPromises()
    expect(during).toBe(0)
    await check.trigger('click')
    await flushPromises()
    expect(ids(wrapper)).toEqual(['12'])
  })

  it('queues a forced refresh during Done and runs it after the write, without resurrecting the row', async () => {
    let current = notes
    const { wrapper, client, request } = panel({ '/notifications': () => ({ json: current }) })
    await flushPromises()
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(client, 'call').mockImplementationOnce(async () => {
      await waiting
      current = current.filter((n) => n.id !== '11')
      return { status: 204, headers: {}, body: null } as never
    })
    await wrapper
      .find('[data-id="11"] .abele-github-notification__mark .abele-obsidian-icon')
      .trigger('click')
    await flushPromises()
    await refresh(wrapper, true)
    const during = request.mock.calls.length
    release()
    await flushPromises()
    expect(during).toBe(1)
    expect(request.mock.calls).toHaveLength(2)
    expect(ids(wrapper)).toEqual(['12'])
  })
})

describe('successful but incomplete access', () => {
  it('quietly explains missing repo scope without blocking the list, including after a 304', async () => {
    const { wrapper } = panel({
      '/notifications': (req: RequestUrlParam) =>
        req.headers?.['If-Modified-Since']
          ? { status: 304 }
          : {
              json: notes,
              headers: {
                'X-OAuth-Scopes': 'notifications, read:user',
                'Last-Modified': 'Fri, 02 Jan 2026 10:00:00 GMT',
              },
            },
    })
    await flushPromises()
    expect(ids(wrapper)).toEqual(['11', '12'])
    const hint = wrapper.find('.abele-github-notifications__access-hint')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('repo scope')
    expect(hint.text()).toContain('private')
    expect(hint.text()).toContain('SSO')
    expect(wrapper.find('.abele-github-notice').exists()).toBe(false)
    await refresh(wrapper, true)
    expect(wrapper.find('.abele-github-notifications__access-hint').text()).toBe(hint.text())
  })

  it('does not invent missing scopes when the header is absent, or warn for a full repo scope', async () => {
    for (const headers of [{}, { 'x-oauth-scopes': 'notifications, repo' }]) {
      const { wrapper } = panel({ '/notifications': { json: notes, headers } })
      await flushPromises()
      expect(wrapper.find('.abele-github-notifications__access-hint').exists()).toBe(false)
    }
  })

  it('warns when GitHub reports partial SSO results even with repo scope', async () => {
    const { wrapper } = panel({
      '/notifications': {
        json: notes,
        headers: {
          'X-OAuth-Scopes': 'repo',
          'X-GitHub-SSO': 'partial-results; organizations=123',
        },
      },
    })
    await flushPromises()
    expect(ids(wrapper)).toEqual(['11', '12'])
    expect(wrapper.find('.abele-github-notifications__access-hint').text()).toContain('SSO')
  })
})
