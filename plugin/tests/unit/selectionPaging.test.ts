/**
 * Pages turned one at a time and words being selected on them: only a clean tap turns a page,
 * and a selection held at the edge turns it on purpose, within its chapter.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { watchPage, type PageHost } from '@/reader/pageInput'
import { EDGE_HOLD_MS, QUIET_MS, SETTLE_MS, SelectionPager } from '@/reader/selectionPaging'
import { LONG_PRESS_MS } from '@/reader/pageGesture'

// The page is the test's own document: happy-dom collapses every range set in a document made
// apart from its window, so a selection could never be made in one.
const page = () => {
  const doc = document
  doc.getSelection()?.removeAllRanges()
  doc.body.innerHTML =
    '<p id="a">Alpha beta gamma delta.</p><p id="b">Epsilon zeta eta theta iota kappa.</p>'
  return doc
}

const stageOf = (width = 400) => {
  const stage = document.createElement('div')
  Object.defineProperty(stage, 'clientWidth', { value: width })
  stage.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: width, bottom: 800, width, height: 800 }) as DOMRect
  return stage
}

const select = (doc: Document, from = 0, to = 5) => {
  const text = doc.getElementById('a')!.firstChild!
  const range = doc.createRange()
  range.setStart(text, from)
  range.setEnd(text, to)
  const sel = doc.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
  doc.dispatchEvent(new Event('selectionchange'))
}

const unselect = (doc: Document) => {
  doc.getSelection()!.removeAllRanges()
  doc.dispatchEvent(new Event('selectionchange'))
}

function setup() {
  const doc = page()
  const reader = {
    goLeft: vi.fn(async () => {}),
    goRight: vi.fn(async () => {}),
    isFixedLayout: false,
    lastLocation: null,
    renderer: Object.assign(new EventTarget(), {
      localName: 'foliate-paginator',
      holdPages: undefined as undefined | (() => boolean),
    }),
  }
  const stage = stageOf()
  const model = { selection: null as unknown, active: null as unknown } as PageHost['model']
  const host: PageHost = {
    reader: () => reader as never,
    stage: () => stage,
    reading: () => null,
    model,
    pdf: false,
    fixed: () => false,
    zoom: () => {},
  }
  watchPage(host, doc)
  const down = (type: 'touch' | 'mouse' = 'touch') => {
    const e = new Event('pointerdown') as PointerEvent
    Object.defineProperty(e, 'pointerType', { value: type })
    doc.dispatchEvent(e)
    if (type === 'touch') doc.dispatchEvent(new Event('touchstart'))
    else doc.dispatchEvent(new Event('mousedown'))
  }
  // A touch is followed by the mouse events a page that knows no touch would need, as Chromium
  // sends them: they are not a gesture of their own.
  const up = (type: 'touch' | 'mouse' = 'touch') => {
    doc.dispatchEvent(new Event('pointerup'))
    if (type === 'touch') {
      doc.dispatchEvent(new Event('touchend'))
      doc.dispatchEvent(new Event('mousedown'))
    }
    doc.dispatchEvent(new Event('mouseup'))
  }
  const click = (x: number) =>
    doc.body.dispatchEvent(new MouseEvent('click', { clientX: x, bubbles: true }))
  /** A whole tap at x: down, up, and the click that follows. */
  const tap = (x: number, type: 'touch' | 'mouse' = 'touch') => {
    down(type)
    up(type)
    click(x)
  }
  return { doc, reader, model, tap, down, up, click }
}

describe('a tap on a page turned one at a time', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }))
  afterEach(() => vi.useRealTimers())

  it('turns the page at an edge when nothing is selected and no bar is open', () => {
    const { reader, tap } = setup()
    tap(390)
    expect(reader.goRight).toHaveBeenCalledTimes(1)
    tap(10, 'mouse')
    expect(reader.goLeft).toHaveBeenCalledTimes(1)
  })

  it('does not turn it when words were selected as the tap began, even if the tap let them go', () => {
    const { doc, reader, down, up, click } = setup()
    const turned = vi.spyOn(SelectionPager.prototype, 'tapTurn').mockResolvedValue(true)
    select(doc)
    down()
    unselect(doc) // the platform lets the selection go before the click arrives
    up()
    click(300)
    expect(reader.goRight).not.toHaveBeenCalled()
    expect(turned).not.toHaveBeenCalled()
    turned.mockRestore()
  })

  it('with words selected, a tap on the very edge turns the page and carries the selection on', () => {
    const { doc, reader, down, up, click } = setup()
    const turned = vi.spyOn(SelectionPager.prototype, 'tapTurn').mockResolvedValue(true)
    select(doc)
    down()
    unselect(doc) // let go by the platform on the tap: the pager is handed what it began with
    up()
    click(390)
    expect(reader.goRight).not.toHaveBeenCalled()
    // Every page the test file has wired listens to this one document: the last call is this page's.
    expect(turned).toHaveBeenCalled()
    expect(turned.mock.lastCall?.[0]).toBe(1)
    expect(turned.mock.lastCall?.[1]?.focus[1]).toBe(5)
    select(doc)
    down()
    up()
    click(8)
    expect(turned.mock.lastCall?.[0]).toBe(-1)
    turned.mockRestore()
  })

  it('does not turn it when the selection bar is open, and a tap beside the highlight bar only closes it', () => {
    const { reader, model, tap } = setup()
    model.selection = { cfi: 'x', text: 'Alpha', label: '' }
    tap(390)
    expect(reader.goRight).not.toHaveBeenCalled()
    model.selection = null
    model.active = { cfi: 'y', color: 'yellow', text: 't', comment: '', label: '' }
    tap(390)
    expect(model.active).toBeNull()
    expect(reader.goRight).not.toHaveBeenCalled()
    // Closed, the next tap turns.
    tap(390)
    expect(reader.goRight).toHaveBeenCalledTimes(1)
  })

  it('does not turn it after a long press, or when the gesture selected words', () => {
    const { doc, reader, down, up, click } = setup()
    down()
    vi.advanceTimersByTime(LONG_PRESS_MS + 50)
    up()
    click(390)
    expect(reader.goRight).not.toHaveBeenCalled()

    down()
    select(doc)
    unselect(doc)
    up()
    click(390)
    expect(reader.goRight).not.toHaveBeenCalled()
  })

  it('holds the engine’s own swipes while a bar is open', () => {
    const { reader, model } = setup()
    expect(reader.renderer.holdPages?.()).toBe(false)
    model.active = { cfi: 'y', color: 'yellow', text: 't', comment: '', label: '' }
    expect(reader.renderer.holdPages?.()).toBe(true)
  })
})

describe('a selection on pages turned one at a time', () => {
  /** The pagers made by a test: all listen to the one document, so each goes when its test does. */
  const made: SelectionPager[] = []
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }))
  afterEach(() => {
    for (const p of made.splice(0)) p.dispose()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /**
   * Two pages: the first paragraph is page 2 of the chapter, the second page 3. Turning moves
   * the range on screen from one to the other and says so, as the engine does.
   */
  function pager(
    opts: { page?: number; pages?: number; fixed?: boolean; scrolled?: boolean } = {}
  ) {
    const doc = page()
    const a = doc.getElementById('a')!.firstChild as Text
    const b = doc.getElementById('b')!.firstChild as Text
    const pageRange = (t: Text) => {
      const r = doc.createRange()
      r.setStart(t, 0)
      r.setEnd(t, t.length)
      return r
    }
    let visible: Range = pageRange(a)
    // Where words are: on screen when their paragraph is the page on screen, far off it else.
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
      const here = this.startContainer === visible.startContainer
      const rect = { left: here ? 20 : 1000, top: 100, width: 30, height: 20 } as DOMRect
      return [rect] as unknown as DOMRectList
    })
    // Pages of two columns, 400 wide: a step under a selection is one column, half a page,
    // which here brings the other paragraph on screen as a whole page would.
    const renderer = Object.assign(new EventTarget(), {
      page: opts.page ?? 2,
      pages: opts.pages ?? 8,
      size: 400,
      start: (opts.page ?? 2) * 400,
      columns: 2,
      scrolled: !!opts.scrolled,
      next: vi.fn(async () => {
        renderer.page++
        renderer.start = renderer.page * 400
        visible = pageRange(b)
        renderer.dispatchEvent(new Event('relocate'))
      }),
      prev: vi.fn(async () => {
        renderer.page--
        renderer.start = renderer.page * 400
        visible = pageRange(a)
        renderer.dispatchEvent(new Event('relocate'))
      }),
      stepBy: vi.fn(async (d: number) => (d > 0 ? renderer.next() : renderer.prev())),
    })
    const told: string[] = []
    const adjusted: boolean[] = []
    const pager = new SelectionPager(
      doc,
      {
        renderer: () => renderer,
        stage: () => stageOf(400),
        fixed: () => !!opts.fixed,
        visible: () => visible,
        adjusting: (on) => adjusted.push(on),
      },
      (m) => told.push(m)
    )
    made.push(pager)
    // Half way down the page unless said otherwise: the top and bottom are edges too.
    const move = (x: number, y = 400) =>
      doc.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, buttons: 1 }))
    const press = () => doc.dispatchEvent(new Event('mousedown'))
    const release = () => doc.dispatchEvent(new Event('mouseup'))
    const sel = doc.getSelection()!
    /** Moves the selection the way WebKit does under a handle, and lets it be heard. */
    const handle = (anchor: [Node, number], focus: [Node, number]) => {
      sel.setBaseAndExtent(anchor[0], anchor[1], focus[0], focus[1])
      doc.dispatchEvent(new Event('selectionchange'))
      vi.advanceTimersByTime(1)
    }
    const selected = () => sel.getRangeAt(0).cloneContents().textContent
    return {
      doc,
      a,
      b,
      renderer,
      told,
      adjusted,
      pager,
      move,
      press,
      release,
      handle,
      selected,
    }
  }

  it('turns forward once a pointer has held it at the right edge, and again while it stays there', () => {
    const { a, renderer, move, press, handle } = pager()
    press()
    handle([a, 0], [a, 5])
    move(200)
    move(395)
    vi.advanceTimersByTime(EDGE_HOLD_MS - 100)
    expect(renderer.next).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(renderer.next).toHaveBeenCalledTimes(1)
    // By half the page, not a whole one: the words just selected stay on screen.
    expect(renderer.stepBy).toHaveBeenCalledWith(200)
  })

  it('turns back at the left edge, and not at all without a selection or once released', () => {
    const { a, renderer, move, press, release, handle } = pager()
    press()
    move(5)
    vi.advanceTimersByTime(EDGE_HOLD_MS * 2)
    expect(renderer.prev).not.toHaveBeenCalled()
    handle([a, 0], [a, 5])
    move(5)
    vi.advanceTimersByTime(EDGE_HOLD_MS + 50)
    expect(renderer.prev).toHaveBeenCalledTimes(1)
    release()
    vi.advanceTimersByTime(EDGE_HOLD_MS * 3)
    expect(renderer.prev).toHaveBeenCalledTimes(1)
  })

  it('with no pointer to follow, turns for an end brought onto the page’s last word and held there, not for one made there', () => {
    const { a, renderer, handle } = pager()
    // Made by a long press on the last word: no turn, however long it rests.
    handle([a, 17], [a, a.length])
    vi.advanceTimersByTime(EDGE_HOLD_MS * 3)
    expect(renderer.next).not.toHaveBeenCalled()
    // Its end taken back and brought down onto the last word again, and held: the page turns.
    handle([a, 17], [a, 20])
    handle([a, 17], [a, a.length])
    vi.advanceTimersByTime(EDGE_HOLD_MS + 50)
    expect(renderer.next).toHaveBeenCalledTimes(1)
  })

  it('with no pointer to follow, moves on for an end dragged into the foot of the page and held there', () => {
    const { a, renderer, handle } = pager()
    handle([a, 0], [a, 5])
    // Its end's line near the foot, above the last: under iOS a finger below the text is taken
    // for a line anywhere near it, and in a scrolled chapter for one out of sight.
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(
      () =>
        [
          { left: 20, top: 740, width: 30, height: 20, bottom: 760 } as DOMRect,
        ] as unknown as DOMRectList
    )
    handle([a, 0], [a, 10])
    vi.advanceTimersByTime(EDGE_HOLD_MS + 50)
    expect(renderer.next).toHaveBeenCalledTimes(1)
  })

  it('turns forward when a handle is held past the foot of the text, as under iOS, and goes on dragging there', async () => {
    // Past the text WebKit selects on to the end of the chapter; the reader stops the end at the
    // page's last word and, held there, turns the page with it.
    const { a, b, renderer, handle, selected } = pager()
    handle([a, 6], [a, 10])
    handle([a, 6], [b, 20])
    expect(selected()).toBe('beta gamma delta.')
    // Still held there: WebKit keeps putting it past the text, and the hold goes on.
    vi.advanceTimersByTime(EDGE_HOLD_MS - 200)
    handle([a, 6], [b, 25])
    expect(renderer.next).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)
    expect(renderer.next).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(20)
    // Its end on the new page's first word, to be dragged on from there.
    expect(selected()).toBe('beta gamma delta.Epsilon')
    handle([a, 6], [b, 20])
    expect(selected()).toBe('beta gamma delta.Epsilon zeta eta the')
  })

  it('turns back when the start is held past the head of the text', async () => {
    const { a, b, renderer, handle, selected } = pager({ page: 3 })
    await renderer.next() // the second paragraph's page on screen, the first one before it
    await vi.advanceTimersByTimeAsync(50)
    handle([b, 20], [b, 8])
    handle([b, 20], [a, 0])
    expect(selected()).toBe('Epsilon zeta eta the')
    await vi.advanceTimersByTimeAsync(EDGE_HOLD_MS + 50)
    expect(renderer.prev).toHaveBeenCalledTimes(1)
  })

  it('turns when a pointer holds it at the bottom of the page, and not half way down', () => {
    const { a, renderer, move, press, handle } = pager()
    press()
    handle([a, 0], [a, 5])
    move(200, 400)
    vi.advanceTimersByTime(EDGE_HOLD_MS * 2)
    expect(renderer.next).not.toHaveBeenCalled()
    move(200, 790)
    vi.advanceTimersByTime(EDGE_HOLD_MS + 50)
    expect(renderer.next).toHaveBeenCalledTimes(1)
  })

  it('tells the host while words are being selected, and again once they have rested', () => {
    const { a, adjusted, handle, press, release, move } = pager()
    handle([a, 0], [a, 5])
    handle([a, 0], [a, 8])
    expect(adjusted).toEqual([true])
    vi.advanceTimersByTime(QUIET_MS - 100)
    handle([a, 0], [a, 10])
    vi.advanceTimersByTime(QUIET_MS - 100)
    expect(adjusted).toEqual([true])
    vi.advanceTimersByTime(200)
    expect(adjusted).toEqual([true, false])
    // A mouse button held keeps it hidden however long the mouse rests.
    press()
    move(200)
    vi.advanceTimersByTime(QUIET_MS * 4)
    expect(adjusted).toEqual([true, false, true])
    release()
    vi.advanceTimersByTime(QUIET_MS + 50)
    expect(adjusted).toEqual([true, false, true, false])
  })

  it('stays on the pages it has been shown on: a handle dragged off the text stops at the page’s end', () => {
    // WebKit takes a point below a page's text for the end of the chapter: the selection runs on.
    const { a, b, handle, selected } = pager()
    handle([a, 6], [a, 10])
    handle([a, 6], [b, 20])
    expect(selected()).toBe('beta gamma delta.')
    // Backwards too: its start held at the page's first word.
    handle([a, 10], [a, 6])
    expect(selected()).toBe('beta')
  })

  it('is carried onto the next page, its end on that page’s first word, then grows there', async () => {
    const { a, b, renderer, pager: p, handle, selected } = pager()
    handle([a, 6], [a, 10])
    const extended = p.extend(1)
    await vi.advanceTimersByTimeAsync(10)
    expect(await extended).toBe(true)
    expect(renderer.next).toHaveBeenCalledTimes(1)
    expect(selected()).toBe('beta gamma delta.Epsilon')
    // Its handle taken on down the new page: nothing holds it back there.
    handle([a, 6], [b, 20])
    expect(selected()).toBe('beta gamma delta.Epsilon zeta eta the')
  })

  it('only turns back when its start is already on the page before', async () => {
    const { a, renderer, pager: p, handle, selected } = pager({ page: 3 })
    handle([a, 6], [a, 10])
    await renderer.next()
    const back = p.extend(-1)
    await vi.advanceTimersByTimeAsync(10)
    expect(await back).toBe(true)
    expect(renderer.prev).toHaveBeenCalledTimes(1)
    expect(selected()).toBe('beta')
  })

  it('works half a screen at a time in a scrolled chapter', async () => {
    const { a, renderer, pager: p, handle, selected } = pager({ scrolled: true })
    Object.assign(renderer, { start: 0, end: 400, viewSize: 2000 })
    handle([a, 6], [a, 10])
    const extended = p.extend(1)
    await vi.advanceTimersByTimeAsync(10)
    expect(await extended).toBe(true)
    expect(renderer.next).toHaveBeenCalledWith(200)
    expect(selected()).toBe('beta gamma delta.Epsilon')
  })

  it('once let go, puts pages moved by a column back on the page where the selection ended', async () => {
    const { a, b, renderer, handle, doc } = pager()
    const show = vi.fn(async () => {})
    Object.assign(renderer, { showAnchor: show })
    handle([a, 6], [b, 7])
    renderer.start = 1000 // a column into the next page
    doc.getSelection()!.removeAllRanges()
    doc.dispatchEvent(new Event('selectionchange'))
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 50)
    expect(show).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(show).toHaveBeenCalledTimes(1)
    const at = (show.mock.calls[0] as unknown as [Range])[0]
    expect([at.startContainer, at.startOffset]).toEqual([b, 7])
  })

  it('a tap that lets the selection go a moment before putting it back leaves the page where it is', async () => {
    const { a, b, renderer, handle, doc } = pager()
    const show = vi.fn(async () => {})
    Object.assign(renderer, { showAnchor: show })
    handle([a, 6], [b, 7])
    renderer.start = 1000
    doc.getSelection()!.removeAllRanges()
    doc.dispatchEvent(new Event('selectionchange'))
    await vi.advanceTimersByTimeAsync(100)
    handle([a, 6], [b, 7])
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)
    expect(show).not.toHaveBeenCalled()
  })

  it('is drawn again after every turn, and still covers the pages it had', async () => {
    // WebKit stops drawing a selection once the page has scrolled; set again, it shows.
    const { a, b, renderer, handle, selected, doc } = pager()
    handle([a, 6], [a, 10])
    const sel = doc.getSelection()!
    const set = vi.spyOn(sel, 'setBaseAndExtent')
    await renderer.next()
    vi.advanceTimersByTime(40)
    expect(set).toHaveBeenCalledTimes(1)
    expect(selected()).toBe('beta')
    await renderer.prev()
    vi.advanceTimersByTime(40)
    expect(set).toHaveBeenCalledTimes(2)
    // Both pages still open to it: its end dragged onto the second one is not held back.
    handle([a, 6], [b, 7])
    expect(selected()).toBe('beta gamma delta.Epsilon')
  })

  it('stops at the end of the chapter and says so, once', async () => {
    const { a, renderer, told, pager: p, handle } = pager({ page: 6, pages: 8 })
    handle([a, 6], [a, 10])
    expect(await p.extend(1)).toBe(false)
    expect(await p.extend(1)).toBe(false)
    expect(renderer.next).not.toHaveBeenCalled()
    expect(told).toEqual(['The selection stops at the end of the chapter.'])
  })

  it('on a PDF page, says why it stays there when the mouse is held at the edge, not only when let go', () => {
    const { a, renderer, told, move, press, handle } = pager({ fixed: true })
    press()
    handle([a, 0], [a, 5])
    move(200)
    move(395)
    vi.advanceTimersByTime(EDGE_HOLD_MS + 50)
    expect(renderer.next).not.toHaveBeenCalled()
    expect(told).toHaveLength(1)
    expect(told[0]).toMatch(/own page/)
    // Held on, it is said once.
    move(396)
    vi.advanceTimersByTime(EDGE_HOLD_MS + 50)
    expect(told).toHaveLength(1)
  })

  it('stays on its page of a PDF, and says why', async () => {
    const { a, renderer, told, pager: p, handle } = pager({ fixed: true })
    handle([a, 0], [a, 5])
    expect(await p.extend(1)).toBe(false)
    expect(renderer.next).not.toHaveBeenCalled()
    expect(told[0]).toMatch(/own page/)
  })
})
