/**
 * The buttons over a drawing in a note (`DrawingEmbedActions.vue`): three to change the part,
 * open it to draw on, or open it, and while the part is changed three others — the whole drawing,
 * leave it, keep it. Each is the kit's icon button, named for a screen reader and found by its
 * class. A press is the button's alone: nothing reaches the note under it, and a finger's lift is
 * never cancelled, since Safari makes no click out of one that was.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import DrawingEmbedActions from '@/components/drawing/DrawingEmbedActions.vue'
import { renderKit, unrenderKit } from '@/components/obsidian/mount'

const names = (el: HTMLElement) =>
  Array.from(el.children).map((b) => /abele-drawing-embed__(\w+)/.exec(b.className)?.[1])

afterEach(() => document.body.replaceChildren())

function bar(props: Record<string, unknown> = {}) {
  const el = document.body.createDiv({ cls: 'abele-drawing-embed__actions' })
  renderKit(el, DrawingEmbedActions, { adjusting: false, ...props })
  return el
}

describe('the drawing embed buttons', () => {
  it('offers to change the part, draw and open, as named icon buttons', () => {
    const el = bar()
    expect(names(el)).toEqual(['adjust', 'open', 'go'])
    const adjust = el.querySelector('.abele-drawing-embed__adjust')!
    expect(adjust.tagName).toBe('BUTTON')
    expect(adjust.classList.contains('clickable-icon')).toBe(true)
    expect(adjust.getAttribute('aria-label')).toBe('Change the part of the drawing shown here')
    expect(el.querySelector('.abele-drawing-embed__open')?.getAttribute('aria-label')).toBe(
      'Open the drawing here to draw on'
    )
    expect(el.querySelector('.abele-drawing-embed__go')?.getAttribute('aria-label')).toBe(
      'Open the drawing'
    )
  })

  it('offers the whole drawing, leaving and keeping while the part is changed, in place', () => {
    const el = bar()
    renderKit(el, DrawingEmbedActions, { adjusting: true })
    expect(names(el)).toEqual(['whole', 'cancel', 'keep'])
    expect(el.querySelector('.abele-drawing-embed__keep')?.getAttribute('aria-label')).toBe(
      'Keep this part'
    )
    unrenderKit(el)
    expect(el.childElementCount).toBe(0)
  })

  it('says which was pressed, and keeps the press from the note', () => {
    const on = {
      onAdjust: vi.fn(),
      onDraw: vi.fn(),
      onOpen: vi.fn(),
      onWhole: vi.fn(),
      onCancel: vi.fn(),
      onKeep: vi.fn(),
    }
    const outside = vi.fn()
    const el = bar(on)
    document.body.addEventListener('click', outside)
    for (const type of ['mousedown', 'mouseup', 'pointerdown', 'touchstart', 'touchend'])
      document.body.addEventListener(type, outside)

    const go = el.querySelector<HTMLElement>('.abele-drawing-embed__go')!
    const lift = new Event('touchend', { bubbles: true, cancelable: true })
    for (const type of ['mousedown', 'mouseup', 'pointerdown', 'touchstart'])
      go.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
    go.dispatchEvent(lift)
    go.click()
    el.querySelector<HTMLElement>('.abele-drawing-embed__open')!.click()
    el.querySelector<HTMLElement>('.abele-drawing-embed__adjust')!.click()
    renderKit(el, DrawingEmbedActions, { adjusting: true, ...on })
    for (const cls of ['whole', 'cancel', 'keep'])
      el.querySelector<HTMLElement>(`.abele-drawing-embed__${cls}`)!.click()

    expect(outside).not.toHaveBeenCalled()
    expect(lift.defaultPrevented).toBe(false)
    for (const handler of Object.values(on)) expect(handler).toHaveBeenCalledOnce()
  })
})
