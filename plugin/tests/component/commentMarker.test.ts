/**
 * The comment marker as a component: the one icon a note's editor, its reading view and a chat
 * answer all draw for a comment. Same markup as before it was a component — the classes, the
 * `data-comment-ids` the e2e harness finds it by, an inline `span` that is pressed like a button.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import CommentMarker from '@/components/CommentMarker.vue'
import { renderKitRoot } from '@/components/obsidian/mount'

const draw = (props: Record<string, unknown> = {}) =>
  renderKitRoot(CommentMarker, { ids: ['k7d2ph'], onPress: () => {}, ...props }).el

afterEach(() => document.body.replaceChildren())

describe('CommentMarker', () => {
  it('is an inline span carrying its ids, its kind and a name', () => {
    const el = draw({ ids: ['k7d2ph', '3mq0xa'] })

    expect(el.tagName).toBe('SPAN')
    expect(el.className).toBe('abele-comment-marker')
    expect(el.getAttribute('data-comment-ids')).toBe('k7d2ph,3mq0xa')
    expect(el.getAttribute('data-comment-kind')).toBe('ai')
    expect(el.getAttribute('role')).toBe('button')
    expect(el.getAttribute('tabindex')).toBe('0')
    expect(el.getAttribute('aria-label')).toBe('Open Ask here')
  })

  it('draws the glyph of its kind', () => {
    expect(draw().querySelector('.abele-comment-marker__icon')?.getAttribute('data-icon')).toBe(
      'message-circle'
    )
    const human = draw({ kind: 'human', unresolved: true })
    expect(human.querySelector('.abele-comment-marker__icon')?.getAttribute('data-icon')).toBe(
      'message-square'
    )
    expect(human.getAttribute('aria-label')).toBe('Open text comments (unresolved passage)')
    expect(human.classList.contains('abele-comment-marker_orphan')).toBe(true)
  })

  it('shows a digit only when something was said', () => {
    expect(draw({ count: 0 }).querySelector('.abele-comment-marker__count')).toBeNull()
    expect(draw({ count: 4 }).querySelector('.abele-comment-marker__count')?.textContent).toBe('4')
  })

  it('says its state and whether it is open with the same classes', () => {
    const el = draw({ state: 'error', open: true })
    expect(el.classList.contains('abele-comment-marker_error')).toBe(true)
    expect(el.classList.contains('abele-comment-marker_open')).toBe(true)
    expect(draw({ state: 'idle' }).classList.contains('abele-comment-marker_idle')).toBe(false)
  })

  it('is pressed by a click, Enter or Space, and keeps the press to itself', () => {
    const onPress = vi.fn()
    const outside = vi.fn()
    const el = draw({ onPress })
    document.body.addEventListener('click', outside)
    document.body.addEventListener('keydown', outside)
    document.body.appendChild(el)

    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    el.dispatchEvent(click)
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))

    expect(onPress).toHaveBeenCalledTimes(3)
    expect(onPress).toHaveBeenCalledWith(['k7d2ph'])
    expect(click.defaultPrevented).toBe(true)
    // Only the unrelated key reaches the page.
    expect(outside).toHaveBeenCalledOnce()
    document.body.removeEventListener('click', outside)
    document.body.removeEventListener('keydown', outside)
  })
})
