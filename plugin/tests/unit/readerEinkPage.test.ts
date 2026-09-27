/**
 * A page in e-ink mode (`src/reader/pageInput.ts` with `src/reader/eink.ts`): a tap anywhere in
 * the left or right third turns it, where a quarter does otherwise; the page keys turn it, the
 * volume keys too; and a key the reader hears is shown while the keys are shown.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { watchPage, type PageHost } from '@/reader/pageInput'
import { eink, initEink, setEink } from '@/reader/eink'

function setup() {
  const doc = document.implementation.createHTMLDocument('page')
  doc.body.innerHTML = '<p>Alpha beta gamma delta.</p>'
  const reader = {
    next: vi.fn(async () => {}),
    prev: vi.fn(async () => {}),
    goLeft: vi.fn(async () => {}),
    goRight: vi.fn(async () => {}),
    isFixedLayout: false,
    lastLocation: null,
    renderer: Object.assign(new EventTarget(), {
      localName: 'foliate-paginator',
      getAttribute: (name: string) => (name === 'flow' ? 'paginated' : null),
    }),
  }
  const width = 600
  const stage = document.createElement('div')
  Object.defineProperty(stage, 'clientWidth', { value: width })
  stage.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: width, bottom: 800, width, height: 800 }) as DOMRect
  const host: PageHost = {
    reader: () => reader as never,
    stage: () => stage,
    reading: () => null,
    model: { selection: null, active: null } as unknown as PageHost['model'],
    pdf: false,
    fixed: () => false,
    zoom: () => {},
  }
  watchPage(host, doc)
  const tap = (x: number) => {
    const at = { clientX: x, clientY: 300 }
    const pointer = (type: string) => {
      const e = new MouseEvent(type, at) as PointerEvent
      Object.defineProperty(e, 'pointerType', { value: 'mouse' })
      doc.dispatchEvent(e)
    }
    pointer('pointerdown')
    pointer('pointerup')
    doc.body.dispatchEvent(new MouseEvent('click', { ...at, bubbles: true }))
  }
  const press = (key: string, extra: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })
    doc.body.dispatchEvent(e)
    return e
  }
  return { reader, tap, press }
}

describe('a page on e-ink', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    initEink({ loadLocalStorage: () => null, saveLocalStorage: () => {} })
  })
  afterEach(() => {
    setEink({ on: false, showKeys: false })
    vi.useRealTimers()
  })

  it('turns on a tap in the left or right third, not only the outer quarter', () => {
    const { reader, tap } = setup()
    // A third in from the right edge, past the outer quarter: nothing, until the mode is on.
    tap(420)
    expect(reader.goRight).not.toHaveBeenCalled()
    setEink({ on: true })
    tap(420)
    expect(reader.goRight).toHaveBeenCalledTimes(1)
    tap(180)
    expect(reader.goLeft).toHaveBeenCalledTimes(1)
    // The middle third is the reader's, not a turn.
    tap(300)
    expect(reader.goLeft).toHaveBeenCalledTimes(1)
    expect(reader.goRight).toHaveBeenCalledTimes(1)
  })

  it('turns through the book with the page keys and the arrows down and up', () => {
    const { reader, press } = setup()
    expect(press('PageDown').defaultPrevented).toBe(true)
    press('ArrowDown')
    press('PageUp')
    expect(reader.next).toHaveBeenCalledTimes(2)
    expect(reader.prev).toHaveBeenCalledTimes(1)
  })

  it('turns with the volume keys in e-ink mode only', () => {
    const { reader, press } = setup()
    expect(press('AudioVolumeDown').defaultPrevented).toBe(false)
    setEink({ on: true })
    press('AudioVolumeDown')
    press('AudioVolumeUp')
    expect(reader.next).toHaveBeenCalledTimes(1)
    expect(reader.prev).toHaveBeenCalledTimes(1)
  })

  it('shows the last key it heard, and what it did with it, while the keys are shown', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { press } = setup()
    setEink({ on: true, showKeys: true })
    press('F13', { code: 'F13', keyCode: 124 })
    expect(eink().heard).toMatchObject({ key: 'F13', code: 'F13', where: 'page', way: null })
    press('PageDown', { code: 'PageDown', keyCode: 34 })
    expect(eink().heard).toMatchObject({ key: 'PageDown', way: 'next' })
    debug.mockRestore()
  })
})
