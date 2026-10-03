import { describe, expect, it } from 'vitest'
import { loadDiscussion, loadIssue, loadPull } from '@/github/api'
import { issueItem, loadList } from '@/github/lists/listData'
import type { GithubClient } from '@/github/client'

const repo = { host: 'github.com', owner: 'sample-org', repo: 'sample-repo' }
const list = { ...repo, kind: 'list' as const, list: 'issues' as const, query: '' }

function client(raw: Record<string, unknown>): GithubClient {
  return {
    get: async () => raw,
    list: async () => ({ items: [], complete: true }),
    graphql: async () => ({
      repository: { discussion: { ...raw, comments: { nodes: [] } } },
      search: { nodes: [raw], discussionCount: 1 },
    }),
  } as unknown as GithubClient
}

describe('GitHub status across a tab and a list', () => {
  it('shows an answered closed discussion as answered in both', async () => {
    const c = client({ number: 7, title: 'Sample question', closed: true, isAnswered: true })
    const tab = await loadDiscussion(c, { ...repo, kind: 'discussion', number: 7 })
    const rows = await loadList(c, { ...list, list: 'discussions' })
    expect(tab.state).toBe('answered')
    expect(rows.items[0].state).toBe(tab.state)
  })

  it('shows a not-planned issue consistently', async () => {
    const raw = { number: 8, title: 'Sample issue', state: 'closed', state_reason: 'not_planned' }
    const tab = await loadIssue(client(raw), { ...repo, kind: 'issue', number: 8 })
    expect(tab.state).toBe('not planned')
    expect(issueItem(list, raw).state).toBe(tab.state)
  })

  it.each([
    { state: 'open', draft: true, merged_at: null, expected: 'draft' },
    { state: 'closed', draft: true, merged_at: null, expected: 'closed' },
    { state: 'closed', draft: true, merged_at: '2025-01-01', expected: 'merged' },
  ])('preserves pull status precedence: $expected', async ({ expected, ...raw }) => {
    const item = { number: 9, title: 'Sample change', ...raw }
    const tab = await loadPull(client(item), { ...repo, kind: 'pull', number: 9 })
    expect(tab.state).toBe(expected)
    expect(issueItem(list, { ...item, pull_request: { merged_at: raw.merged_at } }).state).toBe(
      expected
    )
  })
})
