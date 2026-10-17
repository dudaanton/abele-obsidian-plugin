import { describe, expect, it, vi } from 'vitest'
import { ForgejoClient } from '@/forge/forgejoClient'
import { deployment } from '@/forge/identity'
import { NativeInbox } from '@/forge/forgejoInbox'
describe('native notification semantics', () => {
  it('retains an unsupported same-repository notification target as a browser exit', async () => {
    const url = 'https://git.example.test/team/sample/project/releases/tag/sample-v1'
    const client = new ForgejoClient(
      deployment('gitea', 'https://git.example.test/team'),
      { connectionId: 'browser', generation: 'one', assertCurrent() {} },
      async () => ({
        status: 200,
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
        json: [
          {
            id: 9,
            unread: true,
            pinned: false,
            updated_at: '',
            repository: { full_name: 'sample/project' },
            subject: { title: 'Sample release', type: 'Release', html_url: url },
          },
        ],
      }),
      ''
    )
    const inbox = new NativeInbox(client),
      snapshot = await inbox.load('all')
    expect(inbox.open(snapshot.items[0])).toEqual({ url, tab: false })
    expect(snapshot.items[0].note).toMatch(/browser/i)
  })
  it('rejects foreign snapshots and pinned read mutations before HTTP', async () => {
    const http = vi.fn(async () => ({
      status: 200,
      headers: {},
      text: '',
      arrayBuffer: new ArrayBuffer(0),
      json: [
        {
          id: 8,
          unread: true,
          pinned: true,
          updated_at: '',
          repository: { full_name: 'sample/project' },
          subject: {
            title: 'Sample',
            type: 'Issue',
            html_url: 'https://outside.example.test/sample/project/issues/8',
          },
        },
      ],
    }))
    const client = new ForgejoClient(
      deployment('forgejo', 'https://git.example.test'),
      { connectionId: 'pins', generation: 'one', assertCurrent() {} },
      http,
      ''
    )
    const inbox = new NativeInbox(client),
      snapshot = await inbox.load('all')
    expect(inbox.open(snapshot.items[0]).url).toBe('https://git.example.test/sample/project')
    await expect(inbox.markRead(snapshot.items[0])).rejects.toThrow(/pinned/)
    await expect(new NativeInbox(client).markAllRead(snapshot)).rejects.toThrow(/another inbox/)
    expect(http).toHaveBeenCalledOnce()
  })
  it.each(['forgejo', 'gitea'] as const)(
    'marks %s notifications read without Done or issue-state mutations',
    async (kind) => {
      const base = deployment(kind, 'https://git.example.test/team')
      const http = vi.fn(async () => ({
        status: 200,
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
        json: [
          {
            id: 7,
            unread: true,
            pinned: false,
            updated_at: '2026-01-01T00:00:00Z',
            repository: { full_name: 'sample/project' },
            subject: {
              title: 'Sample issue',
              type: 'Issue',
              html_url: `${base.webBase}/sample/project/issues/12`,
            },
          },
        ],
      }))
      const inbox = new NativeInbox(
        new ForgejoClient(
          base,
          { connectionId: 'sample', generation: kind, assertCurrent() {} },
          http,
          ''
        )
      )
      const snapshot = await inbox.load('all')
      expect(snapshot.cutoff).toBe('2026-01-01T00:00:00.000Z')
      expect(snapshot.items).toMatchObject([{ id: '7', title: 'Sample issue' }])
      expect(inbox.open(snapshot.items[0])).toEqual({
        url: `${base.webBase}/sample/project/issues/12`,
        tab: true,
      })
      await inbox.markRead(snapshot.items[0])
      await inbox.markAllRead(snapshot)
      await expect(inbox.markDone(snapshot.items[0])).rejects.toThrow(/not available/i)
      const writes = http.mock.calls.map(([r]) => r).filter((r) => r.method)
      expect(writes).toHaveLength(2)
      expect(writes[0].url).toBe(`${base.apiBase}/notifications/threads/7?to-status=read`)
      expect(writes[1].url).toContain(`last_read_at=${encodeURIComponent(snapshot.cutoff)}`)
      expect(writes.every((r) => r.url.includes('/notifications'))).toBe(true)
    }
  )
})
