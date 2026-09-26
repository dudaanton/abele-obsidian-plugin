/**
 * The end of a mouse drag is not a click on the page: letting go of the button after selecting
 * words turns nothing, wherever the pointer is let go — the edge included. A click that stays put
 * still turns, with or without words selected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { watchPage, type PageHost } from '@/reader/pageInput'
import { SelectionPager } from '@/reader/selectionPaging'

const page = () => {
  const doc = document
  doc.getSelection()?.removeAllRanges()
  doc.body.replaceChildren(
    ...['Alpha beta gamma delta.', 'Epsilon zeta eta theta iota kappa.'].map((text, i) => {
      const p = doc.createElement('p')
      p.id = i ? 'b' : 'a'
      p.textContent = text
      return p
    })
  )
  return doc
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

function setup() {
  const doc = page()
  const reader = {
    goLeft: vi.fn(async () => {}),
    goRight: vi.fn(async () => {}),
    isFixedLayout: false,
    lastLocation: null,
    renderer: Object.assign(new EventTarget(), { localName: 'foliate-paginator' }),
  }
  const width = 400
  const stage = document.createElement('div')
  Object.defineProperty(stage, 'clientWidth', { value: width })
  stage.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: width, bottom: 800, width, height: 800 }) as DOMRect
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
  const pointer = (type: string, x: number, pointerType: 'mouse' | 'touch') => {
    const e = new MouseEvent(type, { clientX: x, clientY: 300 }) as PointerEvent
    Object.defineProperty(e, 'pointerType', { value: pointerType })
    doc.dispatchEvent(e)
  }
  const down = (x: number, type: 'mouse' | 'touch' = 'mouse') => {
    pointer('pointerdown', x, type)
    doc.dispatchEvent(new MouseEvent(type === 'touch' ? 'touchstart' : 'mousedown'))
  }
  const move = (x: number, type: 'mouse' | 'touch' = 'mouse') => pointer('pointermove', x, type)
  const up = (x: number, type: 'mouse' | 'touch' = 'mouse') => {
    pointer('pointerup', x, type)
    if (type === 'touch') doc.dispatchEvent(new Event('touchend'))
    doc.dispatchEvent(new MouseEvent('mouseup'))
  }
  const click = (x: number) =>
    doc.body.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: 300, bubbles: true }))
  return { doc, reader, down, move, up, click }
}

describe('letting go of the mouse on a page', () => {
  let turned: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    turned = vi.spyOn(SelectionPager.prototype, 'tapTurn').mockResolvedValue(true)
  })
  afterEach(() => {
    turned.mockRestore()
    vi.useRealTimers()
  })

  it('turns nothing after words were selected by dragging, even when let go at the edge', () => {
    const { doc, reader, down, move, up, click } = setup()
    down(120)
    move(250)
    select(doc)
    move(392)
    up(392)
    click(392)
    expect(turned).not.toHaveBeenCalled()
    expect(reader.goRight).not.toHaveBeenCalled()
  })

  it('turns nothing when a new selection is dragged over one already there', () => {
    const { doc, reader, down, move, up, click } = setup()
    select(doc, 0, 5)
    down(120)
    move(300)
    select(doc, 0, 10)
    move(8)
    up(8)
    click(8)
    expect(turned).not.toHaveBeenCalled()
    expect(reader.goLeft).not.toHaveBeenCalled()
  })

  it('turns nothing for a drag that moved but left the selection as it was', () => {
    const { doc, reader, down, move, up, click } = setup()
    select(doc)
    down(200)
    move(392)
    up(392)
    click(392)
    expect(turned).not.toHaveBeenCalled()
    // Nor, with nothing selected, does a drag that ends at the edge.
    doc.getSelection()!.removeAllRanges()
    down(200)
    move(392)
    up(392)
    click(392)
    expect(reader.goRight).not.toHaveBeenCalled()
  })

  it('still turns on a click at the edge, words selected or not, a hand’s tremble included', () => {
    const { doc, reader, down, move, up, click } = setup()
    select(doc)
    down(390)
    move(392)
    up(392)
    click(392)
    // Every page wired in this file listens to the one document: the last call is this page's.
    expect(turned).toHaveBeenCalled()
    expect(turned.mock.lastCall?.[0]).toBe(1)
    doc.getSelection()!.removeAllRanges()
    down(390)
    up(390)
    click(390)
    expect(reader.goRight).toHaveBeenCalledTimes(1)
  })

  it('leaves a finger’s tap at the edge turning as before', () => {
    const { reader, down, move, up, click } = setup()
    down(388, 'touch')
    move(394, 'touch')
    up(394, 'touch')
    click(394)
    expect(reader.goRight).toHaveBeenCalledTimes(1)
  })
})
