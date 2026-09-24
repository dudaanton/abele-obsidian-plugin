/**
 * Scrolling to what the link names. happy-dom lays nothing out, so the tab's scrolling pane is
 * given a height and the target a place 900 px down the content: the test asserts the pane —
 * the element that scrolls in a real tab — was moved to it once it had rendered.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ISSUE, PULL, file, openTab as open } from '../helpers/githubTab'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([])
  document.body.replaceChildren()
})

describe('scrolling to the place a link names', () => {
  const PLACE = 900
  let pane: HTMLElement
  let restore: () => void

  beforeEach(() => {
    pane = document.body.appendChild(document.createElement('div'))
    pane.className = 'view-content'
    pane.style.overflowY = 'auto'
    Object.defineProperty(pane, 'clientHeight', { value: 400, configurable: true })

    const proto = HTMLElement.prototype
    const rects = proto.getBoundingClientRect
    const lists = proto.getClientRects
    const at = (top: number) =>
      ({
        top,
        bottom: top + 20,
        left: 0,
        right: 100,
        width: 100,
        height: 20,
        x: 0,
        y: top,
        toJSON() {},
      }) as DOMRect
    const placed = (el: HTMLElement) =>
      el.matches('.abele-github-comment_target, .cm-content') ? PLACE - pane.scrollTop : null
    proto.getBoundingClientRect = function (this: HTMLElement) {
      if (this === pane) return at(0)
      const top = placed(this)
      return top === null ? rects.call(this) : at(top)
    }
    proto.getClientRects = function (this: HTMLElement) {
      return (placed(this) === null ? lists.call(this) : [at(0)]) as unknown as DOMRectList
    }
    restore = () => {
      proto.getBoundingClientRect = rects
      proto.getClientRects = lists
    }
  })

  afterEach(() => restore())

  it('scrolls the tab to a comment once the conversation is drawn', async () => {
    open(
      'https://github.com/o/r/issues/5#issuecomment-9',
      {
        '/repos/o/r/issues/5': { json: ISSUE },
        '/repos/o/r/issues/5/comments': {
          json: [{ id: 9, user: { login: 'ann' }, body: 'Same here', created_at: '2026-01-02' }],
        },
      },
      true,
      pane
    )
    await vi.waitFor(() => expect(pane.scrollTop).toBe(PLACE - 16))
  })

  it('scrolls the tab to a diff line, leaving a few lines above it', async () => {
    const { diffAnchorHash } = await import('@/github/urls')
    const hash = await diffAnchorHash('src/target.ts')
    open(
      `https://github.com/o/r/pull/7/files#diff-${hash}R3`,
      {
        '/repos/o/r/pulls/7': { json: PULL },
        '/repos/o/r/issues/7/comments': { json: [] },
        '/repos/o/r/pulls/7/reviews': { json: [] },
        '/repos/o/r/pulls/7/comments': { json: [] },
        '/repos/o/r/pulls/7/files': { json: [file('a.ts'), file('src/target.ts')] },
      },
      true,
      pane
    )
    // Two files are drawn; the second one's editor is the one scrolled to, past its first lines.
    await vi.waitFor(() => expect(pane.scrollTop).toBeGreaterThan(PLACE - 96))
    expect(pane.scrollTop).toBeLessThan(PLACE + 200)
  })

  it('opens the files on a review comment, opens its file and marks it', async () => {
    const { wrapper } = open(
      'https://github.com/o/r/pull/7#discussion_r55',
      {
        '/repos/o/r/pulls/7': { json: PULL },
        '/repos/o/r/issues/7/comments': { json: [] },
        '/repos/o/r/pulls/7/reviews': { json: [] },
        '/repos/o/r/pulls/7/comments': {
          json: [
            {
              id: 55,
              path: 'f.ts',
              user: { login: 'ann' },
              body: 'Rename this',
              created_at: '2026-01-03',
              side: 'RIGHT',
              line: 2,
            },
          ],
        },
        '/repos/o/r/pulls/7/files': {
          json: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'].map((n) => file(n)),
        },
      },
      true,
      pane
    )
    await vi.waitFor(() => expect(pane.scrollTop).toBe(PLACE - 16))
    const opened = wrapper
      .findAll('.abele-github-file')
      .filter((f) => f.find('.cm-editor').exists())
    expect(opened.map((f) => f.find('.abele-github-file__path').text())).toEqual(['f.ts'])
    expect(wrapper.find('.abele-github-comment_target').attributes('data-anchor')).toBe(
      'discussion_r55'
    )
  })
})
