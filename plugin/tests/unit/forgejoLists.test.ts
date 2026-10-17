import { describe, expect, it, vi } from 'vitest'
import { ForgejoClient } from '@/forge/forgejoClient'
import { forgejoRepository } from '@/forge/forgejoRepository'
import { deployment } from '@/forge/identity'

describe('native repository lists', () => {
  it.each(['forgejo', 'gitea'] as const)(
    'filters and pages %s rows without forwarding GitHub search syntax',
    async (kind) => {
      const http = vi.fn(async () => ({
        status: 200,
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
        json: [
          {
            number: 1,
            title: 'Sample loader',
            state: 'open',
            user: { login: 'sample' },
            labels: [{ name: 'feature' }],
            created_at: '2026-01-01',
            assignees: [{ login: 'helper' }],
          },
          { number: 2, title: 'Other', state: 'closed', user: { login: 'sample' }, labels: [] },
        ],
      }))
      const source = forgejoRepository(
        new ForgejoClient(
          deployment(kind, 'https://git.example.test/team'),
          { connectionId: 'sample', generation: 'one', assertCurrent() {} },
          http,
          ''
        ),
        'sample/project'
      )
      const target = {
        kind: 'list' as const,
        provider: kind,
        list: 'issues' as const,
        query: 'is:open author:sample assignee:helper label:feature loader',
        owner: 'sample',
        repo: 'project',
        origin: 'https://git.example.test/team',
        host: 'git.example.test',
      }
      expect(await source.github!.loadTarget(target, () => {})).toMatchObject({
        items: [{ number: 1, url: 'https://git.example.test/team/sample/project/issues/1' }],
        total: 1,
        counts: { open: 1, closed: 0 },
        next: null,
      })
      expect(http.mock.calls[0][0].url).toContain('/issues?state=all&type=issues&limit=50&page=1')
      expect(http.mock.calls[0][0].url).not.toContain('author:')
      await expect(
        source.github!.loadTarget({ ...target, list: 'pulls', query: 'review:approved' }, () => {})
      ).rejects.toThrow(/not available/i)
    }
  )
})
