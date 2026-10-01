/** A repeated API snapshot after HTTP 204 is a local fallback, not proof of server-side Done. */
import { describe, expect, it, vi } from 'vitest'
import { GithubClient, type Requester } from '@/github/client'
import { endpoints } from '@/github/urls'
import { inboxFor, NotificationInbox } from '@/github/notifications/inbox'
import type { RawNotification } from '@/github/notifications/model'

const pull = (): RawNotification => ({
  id: '9007199254740993',
  unread: true,
  reason: 'review_requested',
  updated_at: '2026-01-02T10:00:00Z',
  subject: {
    title: 'Sample change',
    type: 'PullRequest',
    url: 'https://api.github.com/repos/sample-org/sample-repo/pulls/73',
    latest_comment_url: null,
  },
  repository: { full_name: 'sample-org/sample-repo' },
})

function server(status = 204) {
  let listed = [pull()]
  let unchanged = false
  const request: Requester = vi.fn(async (req) => ({
    status: req.method === 'DELETE' ? status : unchanged ? 304 : 200,
    headers: { 'Last-Modified': 'Fri, 02 Jan 2026 10:00:00 GMT' },
    json: listed,
    text: JSON.stringify(listed),
    arrayBuffer: new ArrayBuffer(0),
  }))
  const client = new GithubClient(endpoints(''), 'ghp_sample', request)
  return {
    inbox: inboxFor(client),
    client,
    request,
    set: (rows: RawNotification[]) => {
      listed = rows
    },
    notModified: () => {
      unchanged = true
    },
  }
}

describe('local Done fallback', () => {
  it('hides an unchanged PR returned repeatedly after 204 in both lists, including on 304 and reopen', async () => {
    const s = server()
    await s.inbox.load('all')
    await s.inbox.load('unread')
    await s.inbox.markDone(pull().id)
    for (const which of ['all', 'unread'] as const) {
      const page = await s.inbox.load(which, true)
      expect(page.items).toEqual([])
      expect(page.locallyHidden).toBe(1)
    }
    s.notModified()
    expect((await s.inbox.load('all', true)).locallyHidden).toBe(1)
    expect(inboxFor(s.client).cached('all')).toEqual([])
    expect(s.inbox.cachedPage('all')?.locallyHidden).toBe(1)
  })

  it.each(['author', 'review_requested', 'state_change', 'ci_activity'])(
    'does not treat reason %s as a new event by itself',
    async (reason) => {
      const s = server()
      const n = { ...pull(), reason }
      s.set([n])
      await s.inbox.load('all')
      await s.inbox.markDone(n.id)
      s.set([{ ...n, unread: false }])
      expect((await s.inbox.load('all', true)).items).toEqual([])
    }
  )

  it.each(['comment', 'review', 'timestamp', 'reason'])(
    'shows changed %s data rather than guessing that activity is unimportant',
    async (change) => {
      const s = server()
      await s.inbox.load('all')
      await s.inbox.markDone(pull().id)
      const n = pull()
      if (change === 'comment')
        n.subject.latest_comment_url =
          'https://api.github.com/repos/sample-org/sample-repo/issues/comments/86'
      if (change === 'review')
        n.subject.latest_comment_url =
          'https://api.github.com/repos/sample-org/sample-repo/pulls/73/reviews/91'
      if (change === 'timestamp') n.updated_at = '2026-01-02T10:00:01Z'
      if (change === 'reason') n.reason = 'mention'
      s.set([n])
      const page = await s.inbox.load('all', true)
      expect(page.items.map((r) => r.id)).toEqual([n.id])
      expect(page.locallyHidden).toBe(0)
    }
  )

  it.each([403, 404, 422, 304, 200])(
    'never creates local Done memory after HTTP %s',
    async (status) => {
      const s = server(status)
      await s.inbox.load('all')
      await expect(s.inbox.markDone(pull().id)).rejects.toThrow()
      const page = await s.inbox.load('all', true)
      expect(page.items.map((r) => r.id)).toEqual([pull().id])
      expect(page.locallyHidden).toBe(0)
    }
  )

  it('bounds local memory to the last 1,000 confirmed Done versions', async () => {
    const s = server()
    const [snapshot] = (await s.inbox.load('all')).items
    for (let i = 0; i <= 1000; i++) {
      const n = { ...snapshot, id: String(i) }
      await s.inbox.markDone(n.id, n)
    }
    expect(s.inbox.isLocallyDone({ ...snapshot, id: '0' })).toBe(false)
    expect(s.inbox.isLocallyDone({ ...snapshot, id: '1' })).toBe(true)
    expect(s.inbox.isLocallyDone({ ...snapshot, id: '1000' })).toBe(true)
  })

  it('does not share local memory with another token or a newly created client', async () => {
    const s = server()
    await s.inbox.load('all')
    await s.inbox.markDone(pull().id)
    const other = new NotificationInbox(
      new GithubClient(endpoints(''), 'ghp_other_sample', s.request)
    )
    expect((await other.load('all')).items).toHaveLength(1)
  })

  it('remembers the displayed version rather than newer unseen activity in the shared cache', async () => {
    const s = server()
    const page = await s.inbox.load('all')
    s.set([{ ...pull(), updated_at: '2026-01-02T10:00:01Z' }])
    await s.inbox.load('all', true)
    await s.inbox.markDone(pull().id, page.items[0])
    expect((await s.inbox.load('all', true)).items).toHaveLength(1)
  })

  it('does not remember a network failure as Done', async () => {
    const s = server()
    await s.inbox.load('all')
    vi.mocked(s.request).mockRejectedValueOnce(new Error('Sample network interruption'))
    await expect(s.inbox.markDone(pull().id)).rejects.toMatchObject({
      kind: 'network',
      message: 'Could not reach api.github.com.',
    })
    expect((await s.inbox.load('all', true)).items).toHaveLength(1)
  })

  it('lets the user forget the local fallback and see what GitHub lists', async () => {
    const s = server()
    await s.inbox.load('all')
    await s.inbox.markDone(pull().id)
    expect((await s.inbox.load('all', true)).items).toEqual([])
    s.inbox.clearDoneMemory()
    expect(s.inbox.cached('all')).toHaveLength(1)
    expect(s.inbox.cachedPage('all')?.locallyHidden).toBe(0)
  })
})
