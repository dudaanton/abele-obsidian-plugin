/**
 * The icon that stands where the marker's text was.
 *
 * Two things matter beyond it appearing: `data-comment-ids`, which is how both the tests and
 * the e2e harness find a marker on screen, and `eq`, which decides whether CodeMirror keeps
 * the existing DOM. A widget that always reports itself unequal is rebuilt on every keystroke,
 * and a pulsing icon would restart its animation each time.
 */
import { describe, it, expect, vi } from 'vitest'
import { CommentMarkerWidget } from '@/editor/CommentMarkerWidget'
import type { EditorView } from '@codemirror/view'

const noop = () => {}
/** The four arguments before the handler, spelled once: ids, what was said, state, open. */
const widget = (
  ids: string[],
  count = 0,
  state: 'idle' | 'busy' | 'pending' | 'error' = 'idle',
  open = false,
  onClick = noop
) => new CommentMarkerWidget(ids, count, state, open, onClick)
/** The widget only carries the view through to the handler, so an empty object is enough. */
const VIEW = {} as EditorView

describe('the comment marker widget', () => {
  it('carries its ids where the tests and the harness look for them', () => {
    const el = widget(['k7d2ph', '3mq0xa']).toDOM(VIEW)

    expect(el.getAttribute('data-comment-ids')).toBe('k7d2ph,3mq0xa')
    expect(el.classList.contains('abele-comment-marker')).toBe(true)
  })

  it('draws the comment glyph', () => {
    const el = widget(['k7d2ph']).toDOM(VIEW)

    expect(el.querySelector('[data-icon="message-circle"]')).not.toBeNull()
  })

  /**
   * What the digit counts is what was *said* here, not how many comments the marker carries:
   * «считаться должны сообщения в чате». A comment nobody has said anything in yet shows no
   * digit at all — a "0" beside an icon is not information.
   */
  it('counts what was said, and says nothing when nothing was', () => {
    const fresh = widget(['k7d2ph'], 0).toDOM(VIEW)
    const talked = widget(['k7d2ph'], 4).toDOM(VIEW)

    expect(fresh.querySelector('.abele-comment-marker__count')).toBeNull()
    expect(talked.querySelector('.abele-comment-marker__count')?.textContent).toBe('4')
  })

  it('says what state the session is in', () => {
    const busy = widget(['k7d2ph'], 0, 'busy').toDOM(VIEW)
    const pending = widget(['k7d2ph'], 0, 'pending').toDOM(VIEW)
    const failed = widget(['k7d2ph'], 0, 'error', true).toDOM(VIEW)

    expect(busy.classList.contains('abele-comment-marker_busy')).toBe(true)
    expect(pending.classList.contains('abele-comment-marker_pending')).toBe(true)
    expect(failed.classList.contains('abele-comment-marker_error')).toBe(true)
    expect(failed.classList.contains('abele-comment-marker_open')).toBe(true)
  })

  it('adds no state class when the comment is idle and closed', () => {
    const el = widget(['k7d2ph']).toDOM(VIEW)

    expect(el.className).toBe('abele-comment-marker')
  })

  it('hands the press the ids and the view that drew it', () => {
    const onClick = vi.fn()
    const el = widget(['k7d2ph'], 0, 'idle', false, onClick).toDOM(VIEW)

    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    // The view travels with the press because the margin that decides where the card goes is
    // this pane's, not whichever pane Obsidian last called active.
    expect(onClick).toHaveBeenCalledWith(['k7d2ph'], VIEW)
  })

  it('keeps its DOM while the ids, the count and the state hold', () => {
    const first = widget(['k7d2ph'], 2)

    expect(first.eq(widget(['k7d2ph'], 2))).toBe(true)
    // The digit is redrawn when an answer lands, which is the whole point of counting it.
    expect(first.eq(widget(['k7d2ph'], 3))).toBe(false)
    expect(first.eq(widget(['k7d2ph'], 2, 'busy'))).toBe(false)
    expect(first.eq(widget(['k7d2ph'], 2, 'idle', true))).toBe(false)
    expect(first.eq(widget(['k7d2ph', '3mq0xa'], 2))).toBe(false)
  })
})
