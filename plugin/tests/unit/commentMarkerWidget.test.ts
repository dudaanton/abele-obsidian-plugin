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

const noop = () => {}

describe('the comment marker widget', () => {
  it('carries its ids where the tests and the harness look for them', () => {
    const el = new CommentMarkerWidget(['k7d2ph', '3mq0xa'], 'idle', false, noop).toDOM()

    expect(el.getAttribute('data-comment-ids')).toBe('k7d2ph,3mq0xa')
    expect(el.classList.contains('abele-comment-marker')).toBe(true)
  })

  it('draws the comment glyph', () => {
    const el = new CommentMarkerWidget(['k7d2ph'], 'idle', false, noop).toDOM()

    expect(el.querySelector('[data-icon="message-circle"]')).not.toBeNull()
  })

  it('counts the comments only when there is more than one', () => {
    const one = new CommentMarkerWidget(['k7d2ph'], 'idle', false, noop).toDOM()
    const two = new CommentMarkerWidget(['k7d2ph', '3mq0xa'], 'idle', false, noop).toDOM()

    expect(one.querySelector('.abele-comment-marker__count')).toBeNull()
    expect(two.querySelector('.abele-comment-marker__count')?.textContent).toBe('2')
  })

  it('says what state the session is in', () => {
    const busy = new CommentMarkerWidget(['k7d2ph'], 'busy', false, noop).toDOM()
    const pending = new CommentMarkerWidget(['k7d2ph'], 'pending', false, noop).toDOM()
    const failed = new CommentMarkerWidget(['k7d2ph'], 'error', true, noop).toDOM()

    expect(busy.classList.contains('abele-comment-marker_busy')).toBe(true)
    expect(pending.classList.contains('abele-comment-marker_pending')).toBe(true)
    expect(failed.classList.contains('abele-comment-marker_error')).toBe(true)
    expect(failed.classList.contains('abele-comment-marker_open')).toBe(true)
  })

  it('adds no state class when the comment is idle and closed', () => {
    const el = new CommentMarkerWidget(['k7d2ph'], 'idle', false, noop).toDOM()

    expect(el.className).toBe('abele-comment-marker')
  })

  it('hands the ids to the click handler', () => {
    const onClick = vi.fn()
    const el = new CommentMarkerWidget(['k7d2ph'], 'idle', false, onClick).toDOM()

    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onClick).toHaveBeenCalledWith(['k7d2ph'])
  })

  it('keeps its DOM while the ids and the state hold', () => {
    const first = new CommentMarkerWidget(['k7d2ph'], 'idle', false, noop)

    expect(first.eq(new CommentMarkerWidget(['k7d2ph'], 'idle', false, noop))).toBe(true)
    expect(first.eq(new CommentMarkerWidget(['k7d2ph'], 'busy', false, noop))).toBe(false)
    expect(first.eq(new CommentMarkerWidget(['k7d2ph'], 'idle', true, noop))).toBe(false)
    expect(first.eq(new CommentMarkerWidget(['k7d2ph', '3mq0xa'], 'idle', false, noop))).toBe(false)
  })
})
