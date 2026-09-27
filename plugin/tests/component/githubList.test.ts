/**
 * A repository's list of pull requests, issues or discussions in a tab: the query in GitHub's own
 * syntax is the one source of truth — the field shows it, the state tabs and filters rewrite it
 * into a new address for the tab — the counts, the rows opening in tabs, the next page, and what
 * a refusal says.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import type { RequestUrlParam } from 'obsidian'
import { openTab, type Route } from '../helpers/githubTab'
import { useVault } from '../helpers/testEnv'

const item = (number: number, title: string, extra: object = {}) => ({
  number,
  title,
  state: 'open',
  user: { login: 'ann' },
  created_at: '2026-09-01T10:00:00Z',
  comments: 3,
  labels: [{ name: 'bug', color: 'd73a4a' }],
  pull_request: {},
  ...extra,
})

/** GitHub's issue search, answering by what the query asks for. */
function search(total = 2, pages: Record<number, unknown[]> = {}): Route {
  return (req: RequestUrlParam) => {
    const url = new URL(req.url)
    const q = url.searchParams.get('q') ?? ''
    const perPage = Number(url.searchParams.get('per_page'))
    const page = Number(url.searchParams.get('page') ?? 1)
    if (perPage === 1)
      return { json: { total_count: q.includes('is:closed') ? 40 : 12, items: [] } }
    return {
      json: {
        total_count: total,
        items: pages[page] ?? [
          item(12, 'Page the loader'),
          item(11, 'Try drafts', { draft: true }),
        ],
      },
    }
  }
}

const ROUTES: Record<string, Route> = {
  '/search/issues': search(),
  '/repos/o/r/labels': { json: [{ name: 'bug' }, { name: 'good first issue' }] },
  '/repos/o/r/milestones': { json: [{ title: 'v2' }] },
}

const loaded = async (w: VueWrapper) => {
  await vi.waitFor(() => expect(w.find('.abele-github-list').exists()).toBe(true))
  await flushPromises()
}

const click = async (el: Element, init: MouseEventInit = {}) => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
  await flushPromises()
}

const searches = (request: { mock: { calls: [RequestUrlParam][] } }) =>
  request.mock.calls.map(([r]) => new URL(r.url)).filter((u) => u.pathname === '/search/issues')

beforeEach(() => {
  useVault([])
  document.body.replaceChildren()
})

describe('a list of pull requests', () => {
  it("opens for the repository's pulls address, with GitHub's own starting query", async () => {
    const { wrapper, request, onTitle, model } = openTab('https://github.com/o/r/pulls', ROUTES)
    await loaded(wrapper)

    expect((wrapper.find('.abele-github-list__query').element as HTMLInputElement).value).toBe(
      'is:pr is:open'
    )
    const first = searches(request).find((u) => u.searchParams.get('per_page') !== '1')!
    expect(first.searchParams.get('q')).toBe('repo:o/r is:pr is:open')
    expect(first.searchParams.get('sort')).toBe('created')
    expect(wrapper.find('.abele-github-header__title').text()).toBe('Pull requests')
    expect(onTitle).toHaveBeenLastCalledWith('o/r pull requests')
    expect(model.screen.kind).toBe('list')
  })

  it('counts the open and the closed', async () => {
    const { wrapper } = openTab('https://github.com/o/r/pulls', ROUTES)
    await loaded(wrapper)
    const tabs = wrapper.findAll('.abele-github-list__states .abele-tabs__tab').map((t) => t.text())
    expect(tabs[0]).toContain('Open 12')
    expect(tabs[1]).toContain('Closed 40')
  })

  it('draws each row with its state, labels, author and comments, opening in a tab', async () => {
    const { wrapper, onOpen } = openTab('https://github.com/o/r/pulls', ROUTES)
    await loaded(wrapper)

    const rows = wrapper.findAll('.abele-github-list-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('Page the loader')
    expect(rows[0].text()).toContain('#12')
    expect(rows[0].text()).toContain('ann')
    expect(rows[0].find('.abele-badge').text()).toBe('bug')
    expect(rows[1].find('[data-icon="git-pull-request-draft"]').exists()).toBe(true)

    await click(rows[0].element)
    expect(onOpen).toHaveBeenLastCalledWith('https://github.com/o/r/pull/12', false)
    await click(rows[1].element, { metaKey: true })
    expect(onOpen).toHaveBeenLastCalledWith('https://github.com/o/r/pull/11', 'tab')
  })

  it('a state tab rewrites the query into the address the tab follows', async () => {
    const { wrapper, onOpen } = openTab('https://github.com/o/r/pulls', ROUTES)
    await loaded(wrapper)

    const closed = wrapper.findAll('.abele-github-list__states .abele-tabs__tab')[1]
    await click(closed.element)
    expect(onOpen).toHaveBeenLastCalledWith(
      `https://github.com/o/r/pulls?q=${encodeURIComponent('is:pr is:closed')}`,
      false
    )
  })

  it('a typed query goes as it is', async () => {
    const { wrapper, onOpen } = openTab('https://github.com/o/r/pulls', ROUTES)
    await loaded(wrapper)
    const input = wrapper.find('.abele-github-list__query')
    await input.setValue('is:pr is:open author:bob   label:bug')
    await input.trigger('keydown', { key: 'Enter' })
    expect(onOpen).toHaveBeenLastCalledWith(
      `https://github.com/o/r/pulls?q=${encodeURIComponent('is:pr is:open author:bob label:bug')}`,
      false
    )
  })

  it('a filter rewrites its own qualifier and keeps the rest', async () => {
    const { wrapper, onOpen } = openTab(
      `https://github.com/o/r/pulls?q=${encodeURIComponent('is:pr is:open label:bug')}`,
      ROUTES
    )
    await loaded(wrapper)
    const author = wrapper.findAll('.abele-github-list__filter input')[0]
    ;(author.element as HTMLInputElement).value = 'bob'
    await author.trigger('change')
    expect(onOpen).toHaveBeenLastCalledWith(
      `https://github.com/o/r/pulls?q=${encodeURIComponent('is:pr is:open label:bug author:bob')}`,
      false
    )
  })

  it('offers the review states only for pull requests', async () => {
    const pulls = openTab('https://github.com/o/r/pulls', ROUTES)
    await loaded(pulls.wrapper)
    expect(pulls.wrapper.text()).toContain('Review')
    pulls.wrapper.unmount()

    const issues = openTab('https://github.com/o/r/issues', ROUTES)
    await loaded(issues.wrapper)
    expect(issues.wrapper.text()).not.toContain('Review')
    expect(issues.wrapper.text()).toContain('Milestone')
  })

  it('asks for the next page and puts it under the first', async () => {
    const page2 = [item(10, 'Older one')]
    const { wrapper, request } = openTab('https://github.com/o/r/pulls', {
      ...ROUTES,
      '/search/issues': search(26, {
        1: Array.from({ length: 25 }, (_, i) => item(40 - i, `Pull ${40 - i}`)),
        2: page2,
      }),
    })
    await loaded(wrapper)
    expect(wrapper.findAll('.abele-github-list-row')).toHaveLength(25)

    await click(wrapper.find('.abele-github-list__more button').element)
    await flushPromises()
    expect(wrapper.findAll('.abele-github-list-row')).toHaveLength(26)
    expect(searches(request).some((u) => u.searchParams.get('page') === '2')).toBe(true)
    expect(wrapper.find('.abele-github-list__more').exists()).toBe(false)
  })

  it('says why when GitHub refuses the search', async () => {
    const { wrapper } = openTab('https://github.com/o/r/pulls', {
      '/search/issues': {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' },
        json: { message: 'API rate limit exceeded' },
      },
    })
    await vi.waitFor(() => expect(wrapper.find('.abele-github__error').exists()).toBe(true))
    expect(wrapper.find('.abele-github__error').text()).toMatch(/limit/i)
  })

  it('says when nothing matches', async () => {
    const { wrapper } = openTab('https://github.com/o/r/issues', {
      '/search/issues': { json: { total_count: 0, items: [] } },
    })
    await loaded(wrapper)
    expect(wrapper.text()).toContain('No issues match this query.')
  })
})

describe('a list of discussions', () => {
  const discussion = (number: number, title: string, extra: object = {}) => ({
    number,
    title,
    url: `https://github.com/o/r/discussions/${number}`,
    createdAt: '2026-09-01T10:00:00Z',
    closed: false,
    isAnswered: false,
    author: { login: 'carol' },
    category: { name: 'Ideas' },
    comments: { totalCount: 2 },
    labels: { nodes: [] },
    ...extra,
  })
  const graphql: Route = (req) => {
    const { query, variables } = JSON.parse(String(req.body)) as {
      query: string
      variables: Record<string, unknown>
    }
    if (query.includes('discussionCategories')) {
      return {
        json: {
          data: {
            repository: { discussionCategories: { nodes: [{ name: 'Ideas' }, { name: 'Q&A' }] } },
          },
        },
      }
    }
    const q = String(variables.q)
    if (variables.n === 1)
      return {
        json: { data: { search: { discussionCount: q.includes('is:closed') ? 4 : 9, nodes: [] } } },
      }
    return {
      json: {
        data: {
          search: {
            discussionCount: 2,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              discussion(3, 'How should paging work?', { isAnswered: true }),
              discussion(2, 'A new widget'),
            ],
          },
        },
      },
    }
  }

  it('comes from GraphQL, with its categories and whether each is answered', async () => {
    const { wrapper, request, onOpen } = openTab('https://github.com/o/r/discussions', {
      '/graphql': graphql,
      '/repos/o/r/labels': { json: [] },
    })
    await loaded(wrapper)

    const rows = wrapper.findAll('.abele-github-list-row')
    expect(rows.map((r) => r.find('.abele-github-list-row__name').text())).toEqual([
      'How should paging work?',
      'A new widget',
    ])
    expect(rows[0].find('[data-icon="message-square-check"]').exists()).toBe(true)
    expect(rows[0].text()).toContain('Ideas')
    const tabs = wrapper.findAll('.abele-github-list__states .abele-tabs__tab').map((t) => t.text())
    expect(tabs[0]).toContain('Open 9')
    expect(tabs[1]).toContain('Closed 4')
    expect(wrapper.text()).toContain('Category')
    const asked = request.mock.calls
      .map(
        ([r]) => JSON.parse(String(r.body ?? '{}')) as { variables?: { q?: string; n?: number } }
      )
      .find((b) => b.variables?.n === 25)
    expect(asked?.variables?.q).toBe('repo:o/r is:open')

    await click(rows[1].element)
    expect(onOpen).toHaveBeenLastCalledWith('https://github.com/o/r/discussions/2', false)
  })
})
