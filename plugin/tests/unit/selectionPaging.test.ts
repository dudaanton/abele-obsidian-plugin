/**
 * Pages turned one at a time and words being selected on them: only a clean tap turns a page,
 * and a selection held at the edge turns it on purpose, within its chapter.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { watchPage, type PageHost } from '@/reader/pageInput'
import { EDGE_HOLD_MS, LONG_PRESS_MS, SelectionPager } from '@/reader/selectionPaging'

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
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: 800 }) as DOMRect
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
    select(doc)
    down()
    unselect(doc) // the platform lets the selection go before the click arrives
    up()
    click(390)
    expect(reader.goRight).not.toHaveBeenCalled()
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
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }))
  afterEach(() => {
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
    const renderer = Object.assign(new EventTarget(), {
      page: opts.page ?? 2,
      pages: opts.pages ?? 8,
      scrolled: !!opts.scrolled,
      next: vi.fn(async () => {
        renderer.page++
        visible = pageRange(b)
        renderer.dispatchEvent(new Event('relocate'))
      }),
      prev: vi.fn(async () => {
        renderer.page--
        visible = pageRange(a)
        renderer.dispatchEvent(new Event('relocate'))
      }),
    })
    const told: string[] = []
    const pager = new SelectionPager(
      doc,
      {
        renderer: () => renderer,
        stage: () => stageOf(400),
        fixed: () => !!opts.fixed,
        visible: () => visible,
      },
      (m) => told.push(m)
    )
    const move = (x: number) =>
      doc.dispatchEvent(new MouseEvent('mousemove', { clientX: x, buttons: 1 }))
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
    return { doc, a, b, renderer, told, pager, move, press, release, handle, selected }
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

  it('never turns on its own when no pointer is followed, as under iOS’s handles', () => {
    const { a, renderer, handle } = pager()
    handle([a, 0], [a, 5])
    handle([a, 0], [a, a.length])
    vi.advanceTimersByTime(EDGE_HOLD_MS * 5)
    expect(renderer.next).not.toHaveBeenCalled()
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

  it('works a screen at a time in a scrolled chapter', async () => {
    const { a, renderer, pager: p, handle, selected } = pager({ scrolled: true })
    Object.assign(renderer, { start: 0, end: 400, viewSize: 2000 })
    handle([a, 6], [a, 10])
    const extended = p.extend(1)
    await vi.advanceTimersByTimeAsync(10)
    expect(await extended).toBe(true)
    expect(selected()).toBe('beta gamma delta.Epsilon')
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

  it('stays on its page of a PDF, and says why', async () => {
    const { a, renderer, told, pager: p, handle } = pager({ fixed: true })
    handle([a, 0], [a, 5])
    expect(await p.extend(1)).toBe(false)
    expect(renderer.next).not.toHaveBeenCalled()
    expect(told[0]).toMatch(/own page/)
  })
})
