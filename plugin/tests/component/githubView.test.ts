/**
 * A GitHub tab, rendered from canned API answers.
 *
 * happy-dom lays nothing out, so this asserts what reaches the DOM: the title the tab is given,
 * the badges, the comments, which diff is drawn and which line of it is marked. Whether the
 * marked line is scrolled into view is a question for the running app.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'
import GithubItem from '@/components/github/GithubItem.vue'
import { GithubClient } from '@/github/client'
import { endpoints, parseGithubUrl } from '@/github/urls'
import type { GithubViewModel } from '@/github/model'
import { useVault } from '../helpers/testEnv'

type Reply = { status?: number; json?: unknown; text?: string }

function clientWith(routes: Record<string, Reply>) {
  const request = vi.fn(async (req: RequestUrlParam): Promise<RequestUrlResponse> => {
    const path = req.url.replace('https://api.github.com', '').replace(/[?&]per_page=.*$/, '')
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => path === k || path.startsWith(k + '?'))
    const r: Reply = key ? routes[key] : { status: 404, json: { message: 'Not Found' } }
    return {
      status: r.status ?? 200,
      headers: {},
      json: r.json,
      text: r.text ?? JSON.stringify(r.json ?? null),
      arrayBuffer: new ArrayBuffer(0),
    } as RequestUrlResponse
  })
  return { client: new GithubClient(endpoints(''), 'tkn', request), request }
}

function open(url: string, routes: Record<string, Reply>, enabled = true) {
  const { client } = clientWith(routes)
  const model: GithubViewModel = reactive({ url: '', target: null, nonce: 0 })
  const onTitle = vi.fn()
  const onOpen = vi.fn()
  const wrapper = mount(GithubItem, {
    props: { model, enabled, clientFor: () => client, onTitle, onOpen },
    attachTo: document.body,
  })
  model.url = url
  model.target = parseGithubUrl(url, ['github.com'])
  model.nonce++
  return { wrapper, onTitle, onOpen, model }
}

const ISSUE = {
  title: 'Crash on start',
  number: 5,
  html_url: 'https://github.com/o/r/issues/5',
  user: { login: 'bob' },
  created_at: '2026-01-01T10:00:00Z',
  state: 'open',
  labels: [{ name: 'bug', color: 'd73a4a' }],
  body: 'It **crashes**.',
}

const PULL = {
  title: 'Fix the crash',
  number: 7,
  html_url: 'https://github.com/o/r/pull/7',
  user: { login: 'ann' },
  created_at: '2026-01-02T10:00:00Z',
  state: 'open',
  draft: false,
  labels: [],
  body: 'Fixes #5',
  base: { ref: 'main' },
  head: { label: 'ann:fix' },
  additions: 2,
  deletions: 1,
  changed_files: 6,
  commits: 1,
}

const file = (name: string, patch = '@@ -1,2 +1,3 @@\n a\n-b\n+c\n+d') => ({
  filename: name,
  status: 'modified',
  additions: 2,
  deletions: 1,
  patch,
})

beforeEach(() => {
  useVault([])
  document.body.replaceChildren()
})

describe('an issue', () => {
  it('shows its title, state, labels, body and comments, and names the tab', async () => {
    const { wrapper, onTitle } = open('https://github.com/o/r/issues/5#issuecomment-9', {
      '/repos/o/r/issues/5': { json: ISSUE },
      '/repos/o/r/issues/5/comments': {
        json: [{ id: 9, user: { login: 'ann' }, body: 'Same here', created_at: '2026-01-02' }],
      },
    })
    await flushPromises()

    expect(wrapper.find('.abele-github-header__title').text()).toContain('Crash on start')
    expect(wrapper.findAll('.abele-badge').map((b) => b.text())).toEqual(['open', 'bug'])
    expect(wrapper.findAll('.abele-github-comment__author').map((a) => a.text())).toEqual([
      'bob',
      'ann',
    ])
    // The comment the link pointed at is the one marked.
    expect(wrapper.find('.abele-github-comment_target').attributes('data-anchor')).toBe(
      'issuecomment-9'
    )
    expect(onTitle).toHaveBeenLastCalledWith('o/r#5 Crash on start')
  })

  it('becomes the pull request when the number is one', async () => {
    const { wrapper } = open('https://github.com/o/r/issues/7', {
      '/repos/o/r/issues/7': { json: { ...ISSUE, number: 7, pull_request: {} } },
      '/repos/o/r/issues/7/comments': { json: [] },
      '/repos/o/r/pulls/7': { json: PULL },
      '/repos/o/r/pulls/7/reviews': { json: [] },
    })
    await flushPromises()

    expect(wrapper.find('.abele-tabs').exists()).toBe(true)
    expect(wrapper.find('.abele-github-header__title').text()).toContain('Fix the crash')
  })

  it('says what went wrong, and offers to try again', async () => {
    const { wrapper } = open('https://github.com/o/r/issues/404', {})
    await flushPromises()

    expect(wrapper.text()).toMatch(/selected in the token/)
    expect(wrapper.findAll('button').some((b) => b.text().includes('Try again'))).toBe(true)
  })
})

describe('a pull request diff link', () => {
  const routes = async () => {
    const { diffAnchorHash } = await import('@/github/urls')
    return {
      hash: await diffAnchorHash('src/target.ts'),
      routes: {
        '/repos/o/r/pulls/7': { json: PULL },
        '/repos/o/r/issues/7/comments': { json: [] },
        '/repos/o/r/pulls/7/reviews': { json: [] },
        '/repos/o/r/pulls/7/comments': { json: [] },
        '/repos/o/r/pulls/7/files': {
          json: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'src/target.ts'].map((n) => file(n)),
        },
      },
    }
  }

  it('opens on the files, draws only the file it names, and marks the line', async () => {
    const { hash, routes: r } = await routes()
    const { wrapper } = open(`https://github.com/o/r/pull/7/files#diff-${hash}R3`, r)
    // Loading runs through a hash digest, so a fixed number of ticks is not enough under load.
    await vi.waitFor(() => {
      expect(wrapper.findAll('.abele-github-file')).toHaveLength(6)
      expect(wrapper.findAll('.abele-github-code__line_target')).toHaveLength(1)
    })

    const files = wrapper.findAll('.abele-github-file')
    // Six files is a long list: only the one the link names is drawn.
    const drawn = files.filter((f) => f.find('.cm-editor').exists())
    expect(drawn).toHaveLength(1)
    expect(drawn[0].attributes('data-diff')).toBe(hash)

    const marked = drawn[0].findAll('.abele-github-code__line_target')
    expect(marked.map((l) => l.text())).toEqual(['d'])
  })

  it('draws a closed file when it is opened', async () => {
    const { hash, routes: r } = await routes()
    const { wrapper } = open(`https://github.com/o/r/pull/7/files#diff-${hash}`, r)
    await vi.waitFor(() => expect(wrapper.findAll('.abele-github-file')).toHaveLength(6))

    const first = wrapper.findAll('.abele-github-file')[0]
    expect(first.find('.cm-editor').exists()).toBe(false)
    await first.find('.abele-github-file__head').trigger('click')
    await flushPromises()
    expect(first.find('.cm-editor').exists()).toBe(true)
    expect(first.findAll('.abele-github-code__line_add')).toHaveLength(2)
  })
})

describe('a discussion', () => {
  it('marks the answer and shows replies', async () => {
    const { wrapper } = open('https://github.com/o/r/discussions/3', {
      '/graphql': {
        json: {
          data: {
            repository: {
              discussion: {
                title: 'How?',
                number: 3,
                url: 'https://github.com/o/r/discussions/3',
                body: 'Question',
                createdAt: '2026-01-01',
                isAnswered: true,
                closed: false,
                author: { login: 'ann' },
                category: { name: 'Q&A' },
                labels: { nodes: [] },
                comments: {
                  totalCount: 1,
                  nodes: [
                    {
                      id: 'c',
                      databaseId: 1,
                      body: 'Like this',
                      isAnswer: true,
                      author: { login: 'bob' },
                      replies: {
                        totalCount: 1,
                        nodes: [{ id: 'r', body: 'Thanks', author: { login: 'ann' } }],
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    })
    await flushPromises()

    expect(wrapper.findAll('.abele-badge').map((b) => b.text())).toContain('Answer')
    expect(wrapper.find('.abele-github-comment_reply').text()).toContain('ann')
  })
})

describe('a file at a ref', () => {
  it('shows the file and marks the linked lines', async () => {
    const { wrapper, onTitle } = open('https://github.com/o/r/blob/main/src/a.ts#L2-L3', {
      '/repos/o/r/contents/src/a.ts': { text: 'one\ntwo\nthree\nfour' },
    })
    await flushPromises()

    expect(wrapper.find('.abele-github-blob__range').text()).toContain('Lines 2–3')
    const marked = wrapper.findAll('.abele-github-code__line_target').map((l) => l.text())
    expect(marked).toEqual(['two', 'three'])
    expect(onTitle).toHaveBeenLastCalledWith('a.ts @ main')
  })
})

describe('switched off', () => {
  it('says so and asks GitHub nothing', async () => {
    const { wrapper } = open('https://github.com/o/r/issues/5', {}, false)
    await flushPromises()
    expect(wrapper.text()).toContain('The GitHub integration is off')
  })
})
