/**
 * A GitHub tab, rendered from canned API answers.
 *
 * happy-dom lays nothing out, so this asserts what reaches the DOM: the title the tab is given,
 * the badges, the comments, which diff is drawn and which line of it is marked. Whether the
 * marked line is scrolled into view is a question for the running app.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ISSUE, PULL, file, openTab as open, type Reply } from '../helpers/githubTab'
import { parseGithubUrl } from '@/github/urls'
import { useVault } from '../helpers/testEnv'

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

  // The head's path is text to copy: the click that ends a drag over it is not a click on the head.
  it('does not fold or open a file when its path was just selected', async () => {
    const { hash, routes: r } = await routes()
    const { wrapper } = open(`https://github.com/o/r/pull/7/files#diff-${hash}`, r)
    await vi.waitFor(() => expect(wrapper.findAll('.abele-github-file')).toHaveLength(6))

    const first = wrapper.findAll('.abele-github-file')[0]
    const selection = document.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(first.find('.abele-github-file__path').element)
    selection.removeAllRanges()
    selection.addRange(range)
    await first.find('.abele-github-file__head').trigger('click')
    await flushPromises()
    expect(first.find('.cm-editor').exists()).toBe(false)

    // A selection somewhere else is no reason to ignore the click.
    range.selectNodeContents(wrapper.find('.abele-github-header__title').element)
    selection.removeAllRanges()
    selection.addRange(range)
    await first.find('.abele-github-file__head').trigger('click')
    await flushPromises()
    expect(first.find('.cm-editor').exists()).toBe(true)
    selection.removeAllRanges()
  })
})

describe('a pull request whose comments are refused', () => {
  const REFUSED: Reply = {
    status: 403,
    json: { message: 'Resource not accessible by personal access token' },
    headers: { 'X-Accepted-GitHub-Permissions': 'issues=read; pull_requests=read' },
  }
  const base = {
    '/repos/o/r/pulls/7': { json: PULL },
    '/repos/o/r/issues/7/comments': REFUSED,
    '/repos/o/r/pulls/7/reviews': { json: [] },
    '/repos/o/r/pulls/7/comments': { json: [] },
    '/repos/o/r/pulls/7/files': { json: [file('a.ts')] },
  }
  const graphqlComments = {
    json: {
      data: {
        repository: {
          pullRequest: {
            comments: {
              totalCount: 1,
              nodes: [
                {
                  id: 'IC_1',
                  databaseId: 9,
                  body: 'Through GraphQL',
                  createdAt: '2026-01-03T10:00:00Z',
                  author: { login: 'cat' },
                },
              ],
            },
          },
        },
      },
    },
  }

  it('shows the pull request, and in the conversation says what was refused', async () => {
    const { wrapper } = open('https://github.com/o/r/pull/7', {
      ...base,
      '/graphql': { json: { errors: [{ type: 'FORBIDDEN', message: 'Not allowed either' }] } },
    })
    await flushPromises()

    expect(wrapper.find('.abele-github-header__title').text()).toContain('Fix the crash')
    expect(wrapper.find('.abele-github-comment').text()).toContain('Fixes #5')
    const notice = wrapper.find('.abele-github-thread .abele-github-notice')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toMatch(/refused the pull request's comments/)
    expect(notice.text()).toMatch(/Resource not accessible by personal access token/)
    expect(notice.findAll('button').some((b) => b.text().includes('Try again'))).toBe(true)
    expect(wrapper.text()).not.toContain('No comments yet.')
    // No full-tab error.
    expect(wrapper.find('.abele-github__error').exists()).toBe(false)

    await wrapper.findAll('.abele-tabs [role="tab"]')[1].trigger('click')
    await vi.waitFor(() => expect(wrapper.findAll('.abele-github-file')).toHaveLength(1))
  })

  it('asks again for the comments alone when told to', async () => {
    let refuse = true
    const { wrapper } = open('https://github.com/o/r/pull/7', {
      ...base,
      '/repos/o/r/issues/7/comments': () =>
        refuse
          ? REFUSED
          : {
              json: [
                { id: 3, user: { login: 'dan' }, body: 'Now readable', created_at: '2026-01-04' },
              ],
            },
      '/graphql': { json: { errors: [{ type: 'FORBIDDEN', message: 'no' }] } },
    })
    await flushPromises()
    refuse = false
    const retry = wrapper
      .findAll('.abele-github-notice button')
      .find((b) => b.text().includes('Try again'))!
    await retry.trigger('click')
    await flushPromises()

    expect(wrapper.find('.abele-github-notice').exists()).toBe(false)
    expect(wrapper.text()).toContain('Now readable')
    expect(wrapper.find('.abele-github-header__title').text()).toContain('Fix the crash')
  })

  it('shows the comments GraphQL gives when REST refuses them', async () => {
    const { wrapper } = open('https://github.com/o/r/pull/7#issuecomment-9', {
      ...base,
      '/graphql': graphqlComments,
    })
    await flushPromises()

    expect(wrapper.find('.abele-github-notice').exists()).toBe(false)
    expect(wrapper.findAll('.abele-github-comment__author').map((a) => a.text())).toEqual([
      'ann',
      'cat',
    ])
    // The anchor a link names still finds its comment.
    expect(wrapper.find('.abele-github-comment_target').attributes('data-anchor')).toBe(
      'issuecomment-9'
    )
  })

  it('is a full-tab error when the pull request itself is not found', async () => {
    const { wrapper } = open('https://github.com/o/r/pull/8', {
      '/repos/o/r/issues/8/comments': { json: [] },
      '/repos/o/r/pulls/8/reviews': { json: [] },
    })
    await flushPromises()

    expect(wrapper.find('.abele-github__error').text()).toMatch(
      /found nothing for the pull request/
    )
    expect(wrapper.find('.abele-tabs').exists()).toBe(false)
  })
})

describe('an issue whose comments are refused', () => {
  it('shows the issue and a notice where the comments go', async () => {
    const { wrapper } = open('https://github.com/o/r/issues/5', {
      '/repos/o/r/issues/5': { json: ISSUE },
      '/repos/o/r/issues/5/comments': {
        status: 403,
        json: { message: 'Resource not accessible by personal access token' },
      },
      '/graphql': { json: { errors: [{ type: 'FORBIDDEN', message: 'no' }] } },
    })
    await flushPromises()

    expect(wrapper.find('.abele-github-comment').text()).toContain('crashes')
    expect(wrapper.find('.abele-github-notice').text()).toMatch(/refused the issue's comments/)
  })
})

describe('a pull request whose review comments are refused', () => {
  it('shows the files and says the review comments are missing', async () => {
    const { wrapper } = open('https://github.com/o/r/pull/7/files', {
      '/repos/o/r/pulls/7': { json: PULL },
      '/repos/o/r/issues/7/comments': { json: [] },
      '/repos/o/r/pulls/7/reviews': { json: [] },
      '/repos/o/r/pulls/7/files': { json: [file('a.ts')] },
      '/repos/o/r/pulls/7/comments': {
        status: 403,
        json: { message: 'Resource not accessible by personal access token' },
      },
      '/graphql': { json: { errors: [{ type: 'FORBIDDEN', message: 'no' }] } },
    })
    await vi.waitFor(() => expect(wrapper.findAll('.abele-github-file')).toHaveLength(1))
    expect(wrapper.find('.abele-github-notice').text()).toMatch(/review comments/)
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

describe('a file followed to its lines again', () => {
  it('marks the new lines in the editor already drawn, never drawing it afresh', async () => {
    const url = 'https://github.com/o/r/blob/main/src/a.ts#L2-L3'
    const { wrapper, model } = open(url, {
      '/repos/o/r/contents/src/a.ts': { text: 'one\ntwo\nthree\nfour' },
    })
    await vi.waitFor(() =>
      expect(wrapper.findAll('.abele-github-code__line_target').map((l) => l.text())).toEqual([
        'two',
        'three',
      ])
    )
    const editor = wrapper.find('.cm-editor').element

    const follow = async (next: string) => {
      model.url = next
      model.target = parseGithubUrl(next, ['github.com'])
      model.nonce++
      await flushPromises()
    }
    await follow(url)
    expect(wrapper.find('.cm-editor').element).toBe(editor)
    await follow('https://github.com/o/r/blob/main/src/a.ts#L4')
    expect(wrapper.find('.cm-editor').element).toBe(editor)
    expect(wrapper.findAll('.abele-github-code__line_target').map((l) => l.text())).toEqual([
      'four',
    ])
    expect(wrapper.find('.abele-github-blob__range').text()).toContain('Line 4')
  })
})

describe('switched off', () => {
  it('says so and asks GitHub nothing', async () => {
    const { wrapper } = open('https://github.com/o/r/issues/5', {}, false)
    await flushPromises()
    expect(wrapper.text()).toContain('The GitHub integration is off')
  })
})

describe('a tab that follows a link to another item', () => {
  it('shows the new item, never the old one read as the new kind', async () => {
    const { wrapper, model } = open('https://github.com/o/r/issues/5', {
      '/repos/o/r/issues/5': { json: ISSUE },
      '/repos/o/r/issues/5/comments': { json: [] },
      '/repos/o/r/contents/src/app.ts': { text: 'one\ntwo' },
    })
    await vi.waitFor(() => expect(wrapper.find('.abele-github-thread').exists()).toBe(true))

    const url = 'https://github.com/o/r/blob/main/src/app.ts#L2'
    model.url = url
    model.target = parseGithubUrl(url, ['github.com'])
    model.nonce++

    await vi.waitFor(() =>
      expect(wrapper.find('.abele-github-blob .cm-editor').exists()).toBe(true)
    )
    expect(wrapper.find('.abele-github-thread').exists()).toBe(false)
  })
})
