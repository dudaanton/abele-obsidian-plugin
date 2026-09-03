/**
 * The margin column beside the text.
 *
 * Footnotes have hung there since they shipped; comments join them in phase 2, and both go
 * through one overlay so that a comment and a footnote anchored two words apart do not draw
 * on top of each other. What can be pinned down without a browser is the arithmetic: given a
 * measured top and height per entry, where does each one end up. happy-dom computes no
 * layout — `getBoundingClientRect` returns zeros and `coordsAtPos` needs a real one — so the
 * measuring is kept out of this function and stubbed in the tests that drive the overlay.
 */
import { describe, it, expect } from 'vitest'
// The stand-in for the plugin API installs Obsidian's `HTMLElement` helpers on import —
// the overlay calls `toggleClass`, which happy-dom does not ship.
import 'obsidian'
import type { EditorView } from '@codemirror/view'
import {
  stackEntries,
  MARGIN_MIN_SPACE,
  SIDENOTE_GAP,
  MarginOverlay,
  marginOverlayFor,
  marginOverlayIfAny,
  type MarginEntry,
  type MarginEntryKind,
} from '@/editor/MarginOverlay'

describe('stacking margin entries', () => {
  it('leaves an entry where its anchor is when nothing is above it', () => {
    expect(
      stackEntries([
        { id: 'a', anchorPos: 10, top: 0, height: 20 },
        { id: 'b', anchorPos: 90, top: 200, height: 20 },
      ])
    ).toEqual([
      { id: 'a', top: 0 },
      { id: 'b', top: 200 },
    ])
  })

  it('orders footnotes and comments together by document position, not by kind', () => {
    // The ids name the kind for readability only: the arithmetic sees anchorPos and nothing else.
    const placements = stackEntries([
      { id: 'comment-2', anchorPos: 300, top: 90, height: 30 },
      { id: 'footnote-1', anchorPos: 10, top: 0, height: 40 },
      { id: 'comment-1', anchorPos: 20, top: 10, height: 50 },
      { id: 'footnote-2', anchorPos: 400, top: 400, height: 10 },
    ])

    expect(placements.map((p) => p.id)).toEqual([
      'footnote-1',
      'comment-1',
      'comment-2',
      'footnote-2',
    ])
    // 0 → bottom 40; max(10, 44) = 44 → bottom 94; max(90, 98) = 98 → bottom 128; 400 clears it.
    expect(placements.map((p) => p.top)).toEqual([0, 44, 98, 400])
  })

  it('keeps the gap between two entries anchored on the same line', () => {
    const [first, second] = stackEntries([
      { id: 'footnote-1', anchorPos: 10, top: 100, height: 24 },
      { id: 'comment-1', anchorPos: 12, top: 100, height: 24 },
    ])

    expect(first.top).toBe(100)
    expect(second.top).toBe(100 + 24 + SIDENOTE_GAP)
  })

  it('hides an entry whose anchor is out of view and stacks the rest as if it were not there', () => {
    expect(
      stackEntries([
        { id: 'a', anchorPos: 10, top: 0, height: 40 },
        { id: 'b', anchorPos: 20, top: null, height: 40 },
        { id: 'c', anchorPos: 30, top: 10, height: 40 },
      ])
    ).toEqual([
      { id: 'a', top: 0 },
      { id: 'b', top: null },
      { id: 'c', top: 44 },
    ])
  })

  it('does not mutate the list it is given', () => {
    const items = [
      { id: 'b', anchorPos: 90, top: 200, height: 20 },
      { id: 'a', anchorPos: 10, top: 0, height: 20 },
    ]

    stackEntries(items)

    expect(items.map((i) => i.id)).toEqual(['b', 'a'])
  })

  /**
   * A pin is the first entry whose place is the top of the *view* rather than its anchor's
   * line. `top` is not consulted for one: a pin whose anchor has scrolled away is exactly the
   * pin with work to do.
   */
  it('parks a sticky entry at the top of the view however far its anchor is', () => {
    expect(
      stackEntries(
        [
          { id: 'pin', anchorPos: 10, top: 4000, height: 40, sticky: true },
          { id: 'gone', anchorPos: 20, top: null, height: 40, sticky: true },
        ],
        { viewportTop: 500 }
      )
    ).toEqual([
      { id: 'pin', top: 504 },
      { id: 'gone', top: 548 },
    ])
  })

  it('stacks two sticky entries in document order, one gap apart', () => {
    const placements = stackEntries(
      [
        { id: 'second', anchorPos: 200, top: 10, height: 30, sticky: true },
        { id: 'first', anchorPos: 100, top: 10, height: 20, sticky: true },
      ],
      { viewportTop: 0 }
    )

    expect(placements).toEqual([
      { id: 'first', top: SIDENOTE_GAP },
      { id: 'second', top: SIDENOTE_GAP + 20 + SIDENOTE_GAP },
    ])
  })

  it('pushes an ordinary entry below the whole sticky block and leaves a distant one alone', () => {
    const placements = stackEntries(
      [
        { id: 'pin', anchorPos: 10, top: 0, height: 60, sticky: true },
        { id: 'under', anchorPos: 20, top: 10, height: 30 },
        { id: 'far', anchorPos: 900, top: 900, height: 30 },
      ],
      { viewportTop: 0 }
    )

    expect(placements).toEqual([
      { id: 'pin', top: 4 },
      { id: 'under', top: 68 },
      { id: 'far', top: 900 },
    ])
  })

  /**
   * The sticky block pushes down what it would otherwise be drawn over, and nothing else.
   *
   * A card whose anchor is above the visible area still has a measured `top` while its line is
   * inside CodeMirror's rendered range. Clamping that one to the bottom of the pins drags it
   * into the reader's view and stands it beside text it has nothing to do with.
   */
  it('leaves an ordinary entry anchored above the view where its anchor is', () => {
    const placements = stackEntries(
      [
        { id: 'pin', anchorPos: 10, top: 0, height: 100, sticky: true },
        { id: 'above', anchorPos: 20, top: 1500, height: 40 },
        { id: 'inside', anchorPos: 30, top: 2050, height: 40 },
      ],
      { viewportTop: 2000 }
    )

    expect(placements).toEqual([
      { id: 'pin', top: 2004 },
      // 1500 + 40 is still above 2000, so the pins are nowhere near it.
      { id: 'above', top: 1500 },
      // The pins end at 2104; this one would have been drawn under them.
      { id: 'inside', top: 2108 },
    ])
  })

  it('clamps an entry the sticky block only just reaches, by its own height', () => {
    // Anchored above the view, but tall enough to reach into it: this one is drawn over the
    // pins unless it is pushed, which is why the test is on `top + height` and not on `top`.
    const placements = stackEntries(
      [
        { id: 'pin', anchorPos: 10, top: 0, height: 100, sticky: true },
        { id: 'tall', anchorPos: 20, top: 1900, height: 400 },
      ],
      { viewportTop: 2000 }
    )

    expect(placements).toEqual([
      { id: 'pin', top: 2004 },
      { id: 'tall', top: 2108 },
    ])
  })

  it('places exactly as it always did when nothing is sticky and no options are given', () => {
    const items = [
      { id: 'a', anchorPos: 10, top: 0, height: 40 },
      { id: 'b', anchorPos: 20, top: null, height: 40 },
      { id: 'c', anchorPos: 30, top: 10, height: 40 },
    ]

    expect(stackEntries(items)).toEqual(stackEntries(items, {}))
    expect(stackEntries(items, {})).toEqual([
      { id: 'a', top: 0 },
      { id: 'b', top: null },
      { id: 'c', top: 44 },
    ])
  })

  it('states the width below which the margin is unusable', () => {
    expect(MARGIN_MIN_SPACE).toBe(200)
    expect(SIDENOTE_GAP).toBe(4)
  })
})

/**
 * A stand-in for the editor view. A real `EditorView` cannot be built here: happy-dom
 * computes no layout, so `coordsAtPos` has nothing to measure, and Obsidian's editor state
 * fields are not modelled. The overlay touches four things — `scrollDOM`, `contentDOM`,
 * `coordsAtPos` and the scroller's `scrollTop` — and all four are stubbed.
 */
function fakeView(opts: {
  contentRight: number
  scrollerRight: number
  /** Document position → top in viewport coordinates; a missing position is out of view. */
  tops?: Record<number, number>
  scrollTop?: number
}): EditorView {
  const doc = window.document
  const scrollDOM = doc.createElement('div')
  const contentDOM = doc.createElement('div')
  scrollDOM.appendChild(contentDOM)
  doc.body.appendChild(scrollDOM)

  const rect = (right: number) =>
    ({ left: 0, top: 0, right, bottom: 0, width: right, height: 0, x: 0, y: 0 }) as DOMRect

  scrollDOM.getBoundingClientRect = () => rect(opts.scrollerRight)
  contentDOM.getBoundingClientRect = () => rect(opts.contentRight)
  Object.defineProperty(scrollDOM, 'scrollTop', { value: opts.scrollTop ?? 0, writable: true })

  return {
    scrollDOM,
    contentDOM,
    coordsAtPos: (pos: number) => {
      const top = opts.tops?.[pos]
      return top === undefined ? null : { top, bottom: top, left: 0, right: 0 }
    },
  } as unknown as EditorView
}

/** The overlay's own `HIDDEN_CLASS` map, which is private to it. A pin's box is not `pin`-named. */
const HIDDEN: Record<MarginEntryKind, string> = {
  footnote: 'abele-footnote-widget-container_hidden',
  comment: 'abele-comment-widget-container_hidden',
  pin: 'abele-comment-pin-container_hidden',
}

function fakeEntry(
  kind: MarginEntryKind,
  id: string,
  anchorPos: number,
  height: number,
  sticky?: boolean
): MarginEntry {
  const el = window.document.createElement('div')
  el.classList.add(HIDDEN[kind].replace(/_hidden$/, ''))
  // happy-dom reports 0 for every measured box; the height is what the stack is made of. A
  // hidden entry is `display: none` in the real thing, and a box that is not laid out measures
  // 0 — which is what makes the order of un-hiding and measuring matter.
  Object.defineProperty(el, 'offsetHeight', {
    get: () => (el.classList.contains(HIDDEN[kind]) ? 0 : height),
  })
  return { id, kind, anchorPos, el, sticky }
}

describe('the margin overlay', () => {
  it('adds one layer to the scroller and takes it away again', () => {
    const view = fakeView({ contentRight: 700, scrollerRight: 1000 })
    const overlay = new MarginOverlay(view)

    const layer = view.scrollDOM.querySelector('.abele-margin-overlay')
    expect(layer).not.toBeNull()
    // The old name stays on the element: anything that styled the footnote layer by it holds.
    expect(layer?.classList.contains('abele-footnotes-overlay')).toBe(true)

    overlay.destroy()
    expect(view.scrollDOM.querySelector('.abele-margin-overlay')).toBeNull()
  })

  it('stacks footnotes and comments in one column', () => {
    const view = fakeView({
      contentRight: 700,
      scrollerRight: 1000,
      tops: { 10: 0, 20: 10, 300: 90, 400: 400 },
    })
    const overlay = new MarginOverlay(view)
    const f1 = fakeEntry('footnote', 'f1', 10, 40)
    const f2 = fakeEntry('footnote', 'f2', 400, 10)
    const c1 = fakeEntry('comment', 'c1', 20, 50)
    const c2 = fakeEntry('comment', 'c2', 300, 30)

    overlay.setEntries('footnote', [f1, f2])
    overlay.setEntries('comment', [c1, c2])
    overlay.position()

    expect(f1.el.style.top).toBe('0px')
    expect(c1.el.style.top).toBe('44px')
    expect(c2.el.style.top).toBe('98px')
    expect(f2.el.style.top).toBe('400px')
  })

  it('gives every entry the same measured width and left edge', () => {
    const view = fakeView({ contentRight: 700, scrollerRight: 1000, tops: { 10: 0 } })
    const overlay = new MarginOverlay(view)
    const entry = fakeEntry('footnote', 'f1', 10, 40)

    overlay.setEntries('footnote', [entry])
    overlay.position()

    // 300 px of margin: min(300, max(180, 300 - 16)) wide, 8 px right of the text column.
    expect(entry.el.style.width).toBe('284px')
    expect(entry.el.style.left).toBe('708px')
  })

  it('hides an entry whose anchor scrolled out of view, by its own kind', () => {
    const view = fakeView({ contentRight: 700, scrollerRight: 1000, tops: { 10: 0 } })
    const overlay = new MarginOverlay(view)
    const shown = fakeEntry('footnote', 'f1', 10, 40)
    const gone = fakeEntry('comment', 'c1', 999, 40)

    overlay.setEntries('footnote', [shown])
    overlay.setEntries('comment', [gone])
    overlay.position()

    expect(shown.el.classList.contains('abele-footnote-widget-container_hidden')).toBe(false)
    expect(gone.el.classList.contains('abele-comment-widget-container_hidden')).toBe(true)
  })

  it('leaves one provider alone when another replaces its entries', () => {
    const view = fakeView({ contentRight: 700, scrollerRight: 1000, tops: { 10: 0, 20: 10 } })
    const overlay = new MarginOverlay(view)
    const footnote = fakeEntry('footnote', 'f1', 10, 40)
    const comment = fakeEntry('comment', 'c1', 20, 50)

    overlay.setEntries('footnote', [footnote])
    overlay.setEntries('comment', [comment])
    overlay.position()
    overlay.setEntries('footnote', [])
    overlay.position()

    expect(footnote.el.isConnected).toBe(false)
    expect(comment.el.isConnected).toBe(true)
    // Nothing above it any more, so it sits at its anchor.
    expect(comment.el.style.top).toBe('10px')
  })

  it('parks a sticky entry at the scroller\u2019s own scrollTop, not at its anchor', () => {
    const view = fakeView({
      contentRight: 700,
      scrollerRight: 1000,
      tops: { 10: 0 },
      scrollTop: 500,
    })
    const overlay = new MarginOverlay(view)
    const pin = fakeEntry('pin', 'p1', 10, 40, true)

    overlay.setEntries('pin', [pin])
    overlay.position()

    expect(pin.el.style.top).toBe(`${500 + SIDENOTE_GAP}px`)
  })

  it('hides a pin by its own container name when there is no room', () => {
    const view = fakeView({ contentRight: 900, scrollerRight: 1000, tops: { 10: 0 } })
    const overlay = new MarginOverlay(view)
    const pin = fakeEntry('pin', 'p1', 10, 40, true)

    overlay.setEntries('pin', [pin])
    overlay.position()

    expect(overlay.hasRoom()).toBe(false)
    expect(pin.el.classList.contains('abele-comment-pin-container_hidden')).toBe(true)
  })

  it('keeps one overlay per view and forgets it when it is destroyed', () => {
    const view = fakeView({ contentRight: 700, scrollerRight: 1000 })
    const other = fakeView({ contentRight: 700, scrollerRight: 1000 })

    const overlay = marginOverlayFor(view)
    expect(marginOverlayFor(view)).toBe(overlay)
    expect(marginOverlayFor(other)).not.toBe(overlay)

    overlay.destroy()
    expect(marginOverlayFor(view)).not.toBe(overlay)
  })

  it('keeps the registered overlay when a second one on the same view is destroyed', () => {
    const view = fakeView({ contentRight: 700, scrollerRight: 1000 })
    const registered = marginOverlayFor(view)

    // Phase 2 has two providers on one view; only the one in the map may be evicted from it.
    new MarginOverlay(view).destroy()

    expect(marginOverlayFor(view)).toBe(registered)
    registered.destroy()
  })

  it('answers what a view already has without building one', () => {
    const view = fakeView({ contentRight: 700, scrollerRight: 1000 })

    expect(marginOverlayIfAny(view)).toBeUndefined()
    // Asking must not have created one: a teardown path reads through this.
    expect(view.scrollDOM.querySelector('.abele-margin-overlay')).toBeNull()

    const overlay = marginOverlayFor(view)

    expect(marginOverlayIfAny(view)).toBe(overlay)

    overlay.destroy()

    expect(marginOverlayIfAny(view)).toBeUndefined()
    expect(view.scrollDOM.querySelector('.abele-margin-overlay')).toBeNull()
  })

  it('takes its entries out of the document when it is destroyed', () => {
    const view = fakeView({ contentRight: 700, scrollerRight: 1000, tops: { 10: 0, 20: 10 } })
    const overlay = new MarginOverlay(view)
    const footnote = fakeEntry('footnote', 'f1', 10, 40)
    const comment = fakeEntry('comment', 'c1', 20, 50)

    overlay.setEntries('footnote', [footnote])
    overlay.setEntries('comment', [comment])
    overlay.position()
    overlay.destroy()

    expect(footnote.el.isConnected).toBe(false)
    expect(comment.el.isConnected).toBe(false)
  })

  it('does nothing when a provider registers or re-measures after it is destroyed', () => {
    const view = fakeView({ contentRight: 700, scrollerRight: 1000, tops: { 10: 0 } })
    const overlay = new MarginOverlay(view)

    overlay.destroy()
    const late = fakeEntry('comment', 'c1', 10, 40)
    overlay.setEntries('comment', [late])
    overlay.position()

    expect(late.el.isConnected).toBe(false)
    expect(late.el.style.top).toBe('')
  })
})

describe('whether the margin has room', () => {
  it('reports no room under 200px and hides everything', () => {
    const view = fakeView({ contentRight: 900, scrollerRight: 1000, tops: { 10: 0 } })
    const overlay = new MarginOverlay(view)
    const footnote = fakeEntry('footnote', 'f1', 10, 40)
    const comment = fakeEntry('comment', 'c1', 10, 40)

    overlay.setEntries('footnote', [footnote])
    overlay.setEntries('comment', [comment])
    overlay.position()

    expect(overlay.hasRoom()).toBe(false)
    expect(footnote.el.classList.contains('abele-footnote-widget-container_hidden')).toBe(true)
    expect(comment.el.classList.contains('abele-comment-widget-container_hidden')).toBe(true)
    expect(footnote.el.style.top).toBe('')
  })

  it('reports room at exactly 200px', () => {
    const view = fakeView({ contentRight: 800, scrollerRight: 1000, tops: { 10: 0 } })
    const overlay = new MarginOverlay(view)

    overlay.setEntries('footnote', [fakeEntry('footnote', 'f1', 10, 40)])
    overlay.position()

    expect(overlay.hasRoom()).toBe(true)
  })

  it('tells a listener when the answer changes, and only then', () => {
    let scrollerRight = 1000
    const view = fakeView({ contentRight: 700, scrollerRight: 1000, tops: { 10: 0 } })
    view.scrollDOM.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: scrollerRight,
        bottom: 0,
        width: scrollerRight,
        height: 0,
        x: 0,
        y: 0,
      }) as DOMRect

    const overlay = new MarginOverlay(view)
    const seen: boolean[] = []
    const stop = overlay.onRoomChange((hasRoom) => seen.push(hasRoom))

    overlay.position()
    overlay.position()
    expect(seen).toEqual([true])

    scrollerRight = 800
    overlay.position()
    expect(seen).toEqual([true, false])

    stop()
    scrollerRight = 1000
    overlay.position()
    expect(seen).toEqual([true, false])
    expect(overlay.hasRoom()).toBe(true)
  })

  it('measures an entry only after taking the hidden modifier off it', () => {
    // A pane too narrow to hold the column hides every entry; a hidden entry is not laid out,
    // so it measures 0. Widening the pane must un-hide them before their heights are read, or
    // two entries anchored on the same line stack a bare gap apart and draw on top of each other.
    let scrollerRight = 800
    const view = fakeView({ contentRight: 700, scrollerRight: 800, tops: { 10: 100, 12: 100 } })
    view.scrollDOM.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: scrollerRight,
        bottom: 0,
        width: scrollerRight,
        height: 0,
        x: 0,
        y: 0,
      }) as DOMRect

    const overlay = new MarginOverlay(view)
    const first = fakeEntry('footnote', 'f1', 10, 24)
    const second = fakeEntry('comment', 'c1', 12, 24)

    overlay.setEntries('footnote', [first])
    overlay.setEntries('comment', [second])
    overlay.position()
    expect(overlay.hasRoom()).toBe(false)
    expect(first.el.classList.contains('abele-footnote-widget-container_hidden')).toBe(true)

    scrollerRight = 1000
    overlay.position()

    expect(first.el.style.top).toBe('100px')
    expect(second.el.style.top).toBe(`${100 + 24 + SIDENOTE_GAP}px`)
  })
})
