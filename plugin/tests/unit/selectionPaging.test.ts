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
    renderer: {
      localName: 'foliate-paginator',
      holdPages: undefined as undefined | (() => boolean),
    },
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

describe('a selection held at the edge of the page', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }))
  afterEach(() => vi.useRealTimers())

  function pager(opts: { page?: number; pages?: number; fixed?: boolean; touch?: boolean } = {}) {
    const doc = page()
    const renderer = {
      page: opts.page ?? 2,
      pages: opts.pages ?? 8,
      next: vi.fn(async () => {}),
      prev: vi.fn(async () => {}),
    }
    const told: string[] = []
    let visible: Range | null = null
    new SelectionPager(
      doc,
      {
        renderer: () => renderer,
        stage: () => stageOf(400),
        fixed: () => !!opts.fixed,
        visible: () => visible,
        touch: () => opts.touch ?? false,
      },
      (m) => told.push(m)
    )
    const move = (x: number) => {
      const e = new MouseEvent('mousemove', { clientX: x, buttons: 1 })
      doc.dispatchEvent(e)
    }
    const press = () => doc.dispatchEvent(new Event('mousedown'))
    const release = () => doc.dispatchEvent(new Event('mouseup'))
    return { doc, renderer, told, move, press, release, setVisible: (r: Range) => (visible = r) }
  }

  it('turns forward once it has rested at the right edge, and again while it stays there', () => {
    const { doc, renderer, move, press } = pager()
    press()
    select(doc)
    move(200)
    move(395)
    vi.advanceTimersByTime(EDGE_HOLD_MS - 100)
    expect(renderer.next).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(renderer.next).toHaveBeenCalledTimes(1)
  })

  it('turns back at the left edge, and not at all without a selection or once released', () => {
    const { doc, renderer, move, press, release } = pager()
    press()
    move(5)
    vi.advanceTimersByTime(EDGE_HOLD_MS * 2)
    expect(renderer.prev).not.toHaveBeenCalled()
    select(doc)
    move(5)
    vi.advanceTimersByTime(EDGE_HOLD_MS + 50)
    expect(renderer.prev).toHaveBeenCalledTimes(1)
    release()
    vi.advanceTimersByTime(EDGE_HOLD_MS * 3)
    expect(renderer.prev).toHaveBeenCalledTimes(1)
  })

  it('stops at the end of the chapter and says so, once', () => {
    const { doc, renderer, told, move, press } = pager({ page: 6, pages: 8 })
    press()
    select(doc)
    move(395)
    vi.advanceTimersByTime(EDGE_HOLD_MS * 3)
    expect(renderer.next).not.toHaveBeenCalled()
    expect(told).toEqual(['The selection stops at the end of the chapter.'])
  })

  it('stays on its page of a PDF, and says why', () => {
    const { doc, renderer, told, move, press } = pager({ fixed: true })
    press()
    select(doc)
    move(395)
    vi.advanceTimersByTime(EDGE_HOLD_MS + 50)
    expect(renderer.next).not.toHaveBeenCalled()
    expect(told[0]).toMatch(/own page/)
  })

  it('with no pointer to follow, turns when a moved end rests on the last word of the page', () => {
    const { doc, renderer, setVisible } = pager({ touch: true })
    const b = doc.getElementById('b')!.firstChild!
    const visible = doc.createRange()
    visible.setStart(doc.getElementById('a')!.firstChild!, 0)
    visible.setEnd(b, b.textContent!.length)
    setVisible(visible)
    // Selected by a long press on the last word: that alone does not turn.
    const sel = doc.getSelection()!
    // A handle dragged moves one end of the selection; it is never let go and made again.
    sel.removeAllRanges()
    const at = (from: [Node, number], to: [Node, number]) => {
      sel.setBaseAndExtent(from[0], from[1], to[0], to[1])
      doc.dispatchEvent(new Event('selectionchange'))
    }
    at([b, 29], [b, 34])
    vi.advanceTimersByTime(EDGE_HOLD_MS * 2)
    expect(renderer.next).not.toHaveBeenCalled()
    // Its start handle moved back to the middle of the page: no turn either.
    at([b, 8], [b, 34])
    vi.advanceTimersByTime(EDGE_HOLD_MS * 2)
    expect(renderer.next).not.toHaveBeenCalled()
    // A selection's end handle dragged down onto the last word does turn.
    at([b, 8], [b, 20])
    at([b, 8], [b, 33])
    vi.advanceTimersByTime(EDGE_HOLD_MS + 50)
    expect(renderer.next).toHaveBeenCalledTimes(1)
  })
})
