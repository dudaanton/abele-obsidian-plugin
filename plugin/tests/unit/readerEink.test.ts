/**
 * E-ink mode (`src/reader/eink.ts`): the keys that turn pages, the device's own choice, what the
 * mode does to the reader's settings and colours, the shapes highlights take, and when the page
 * flashes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import {
  DEFAULT_EINK,
  EINK_KEY,
  REFRESH_EVERY,
  eink,
  einkShape,
  einkStateFrom,
  einkTheme,
  EINK_CLASS,
  followEink,
  EINK_BODY_CLASS,
  flashDue,
  heardKey,
  initEink,
  pageKeyWay,
  setEink,
  withEink,
} from '@/reader/eink'
import { einkBoxStyle, einkMark } from '@/reader/einkMarks'
import { DEFAULT_READER_SETTINGS } from '@/reader/settings'
import { HIGHLIGHT_COLORS } from '@/reader/highlights'

const key = (key: string, extra: Partial<KeyboardEvent> = {}) =>
  ({
    key,
    code: '',
    keyCode: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...extra,
  }) as KeyboardEvent

const plain = { eink: false, paged: true }
const scrolled = { eink: false, paged: false }
const einkOn = { eink: true, paged: true }

describe('page keys', () => {
  it('turns through the book with Page Up and Page Down', () => {
    expect(pageKeyWay(key('PageDown'), plain)).toBe('next')
    expect(pageKeyWay(key('PageUp'), plain)).toBe('prev')
  })

  it('turns towards a side of the screen with the left and right arrows', () => {
    expect(pageKeyWay(key('ArrowRight'), plain)).toBe('right')
    expect(pageKeyWay(key('ArrowLeft'), plain)).toBe('left')
  })

  it('turns forward with the space bar, and back with Shift', () => {
    expect(pageKeyWay(key(' '), plain)).toBe('next')
    expect(pageKeyWay(key(' ', { shiftKey: true }), plain)).toBe('prev')
  })

  it('turns with the up and down arrows only where pages are turned', () => {
    expect(pageKeyWay(key('ArrowDown'), plain)).toBe('next')
    expect(pageKeyWay(key('ArrowUp'), plain)).toBe('prev')
    // A scrolled chapter is scrolled by them, as any page is.
    expect(pageKeyWay(key('ArrowDown'), scrolled)).toBeNull()
    expect(pageKeyWay(key('ArrowUp'), { eink: true, paged: false })).toBe('prev')
  })

  it('leaves a shortcut alone', () => {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const)
      expect(pageKeyWay(key('PageDown', { [mod]: true }), einkOn)).toBeNull()
  })

  it('hears the volume and media keys a reader may send, in e-ink mode only', () => {
    expect(pageKeyWay(key('AudioVolumeDown'), einkOn)).toBe('next')
    expect(pageKeyWay(key('AudioVolumeUp'), einkOn)).toBe('prev')
    expect(pageKeyWay(key('MediaTrackNext'), einkOn)).toBe('next')
    expect(pageKeyWay(key('MediaTrackPrevious'), einkOn)).toBe('prev')
    expect(pageKeyWay(key('AudioVolumeDown'), plain)).toBeNull()
  })

  it('reads a key the browser has no name for by its classic code', () => {
    expect(pageKeyWay(key('Unidentified', { keyCode: 34 }), plain)).toBe('next')
    expect(pageKeyWay(key('Unidentified', { keyCode: 33 }), plain)).toBe('prev')
    expect(pageKeyWay(key('Unidentified', { keyCode: 65 }), einkOn)).toBeNull()
  })

  it('leaves letters to whatever else wants them', () => {
    expect(pageKeyWay(key('a'), einkOn)).toBeNull()
    expect(pageKeyWay(key('Enter'), einkOn)).toBeNull()
  })
})

describe("the device's choice", () => {
  let saved: Record<string, unknown>
  const store = {
    loadLocalStorage: (k: string) => saved[k] ?? null,
    saveLocalStorage: vi.fn((k: string, v: unknown) => {
      if (v === null) delete saved[k]
      else saved[k] = v
    }),
  }
  beforeEach(() => {
    saved = {}
    store.saveLocalStorage.mockClear()
    initEink(store)
  })

  it('is off until chosen, and nothing is kept for it', () => {
    expect(eink().on).toBe(false)
    expect(saved[EINK_KEY]).toBeUndefined()
  })

  it('is kept on this device when switched on, and read back', () => {
    setEink({ on: true, refreshEvery: 10 })
    expect(saved[EINK_KEY]).toEqual({ on: true, refreshEvery: 10, showKeys: false })
    initEink({ ...store })
    expect(eink()).toMatchObject({ on: true, refreshEvery: 10 })
  })

  it('forgets the entry once everything is back to the default', () => {
    setEink({ on: true })
    setEink({ on: false })
    expect(saved[EINK_KEY]).toBeUndefined()
  })

  it('is made whole from anything stored', () => {
    expect(einkStateFrom(null)).toEqual(DEFAULT_EINK)
    expect(einkStateFrom({ on: 'yes', refreshEvery: 7, showKeys: 1 })).toEqual(DEFAULT_EINK)
    for (const every of REFRESH_EVERY)
      expect(einkStateFrom({ refreshEvery: every }).refreshEvery).toBe(every)
  })

  it('notes the last key heard only while the keys are shown', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    heardKey(key('PageDown', { code: 'PageDown', keyCode: 34 }), 'page', 'next')
    expect(eink().heard).toBeNull()
    setEink({ showKeys: true })
    heardKey(key('PageDown', { code: 'PageDown', keyCode: 34 }), 'page', 'next')
    expect(eink().heard).toMatchObject({
      key: 'PageDown',
      code: 'PageDown',
      keyCode: 34,
      way: 'next',
    })
    expect(debug).toHaveBeenCalled()
    setEink({ showKeys: false })
    expect(eink().heard).toBeNull()
    debug.mockRestore()
  })
})

describe('what the mode does to the reader', () => {
  it('turns pages, a PDF too, in the reader colours, never dark', () => {
    const s = withEink(
      { ...DEFAULT_READER_SETTINGS, flow: 'scrolled', pdfLayout: 'scrolled', themeColors: false },
      true
    )
    expect(s).toMatchObject({
      flow: 'paginated',
      pdfLayout: 'paginated',
      themeColors: true,
      pdfDarkPages: false,
    })
  })

  it('leaves the settings as they are when off', () => {
    const s = { ...DEFAULT_READER_SETTINGS, flow: 'scrolled' as const }
    expect(withEink(s, false)).toBe(s)
  })

  it('draws a page black on white whatever the theme', () => {
    const t = einkTheme({
      text: 'rgb(220, 220, 220)',
      background: 'rgb(30, 30, 30)',
      accent: 'purple',
      selection: 'rgba(0,0,0,.2)',
      fontText: 'Inter',
      dark: true,
    })
    expect(t).toMatchObject({
      text: 'CanvasText',
      background: 'Canvas',
      accent: 'CanvasText',
      dark: false,
    })
    expect(t.fontText).toBe('Inter')
  })
})

describe('highlights on e-ink', () => {
  it('gives every colour a shape of its own', () => {
    const shapes = HIGHLIGHT_COLORS.map(einkShape)
    expect(new Set(shapes).size).toBe(HIGHLIGHT_COLORS.length)
  })

  it('draws lines, never a fill, over a book page', () => {
    for (const color of HIGHLIGHT_COLORS) {
      const g = einkMark(einkShape(color))([new DOMRect(10, 20, 100, 16)], { color: 'black' })
      expect(g.localName).toBe('g')
      expect(g.childElementCount).toBeGreaterThan(0)
      // Nothing laid over the words as a translucent wash.
      expect(g.getAttribute('opacity')).toBeNull()
      expect(g.style.opacity).toBe('')
    }
  })

  it('draws a box over a PDF page as its border, never its background', () => {
    for (const color of HIGHLIGHT_COLORS) {
      const style = einkBoxStyle(einkShape(color), 'black')
      expect(style['background-color']).toBeUndefined()
      expect(Object.keys(style).some((k) => k.startsWith('border'))).toBe(true)
    }
  })
})

describe('the flash that clears the ghosting', () => {
  it('comes every so many turns', () => {
    expect([1, 2, 3, 4, 5, 6, 10].filter((n) => flashDue(n, 5))).toEqual([5, 10])
  })

  it('never comes when set to never', () => {
    expect(flashDue(10, 0)).toBe(false)
    expect(flashDue(0, 5)).toBe(false)
  })
})

describe('a book tab following the mode', () => {
  beforeEach(() => initEink({ loadLocalStorage: () => null, saveLocalStorage: () => {} }))

  it('carries the class while the mode is on, and hears every switch', async () => {
    const el = document.createElement('div')
    const changed = vi.fn()
    const stop = followEink(el, changed)
    expect(el.classList.contains(EINK_CLASS)).toBe(false)
    setEink({ on: true })
    await nextTick()
    expect(el.classList.contains(EINK_CLASS)).toBe(true)
    expect(changed).toHaveBeenLastCalledWith(true)
    // The keys shown or the flash change nothing about the page.
    setEink({ showKeys: true, refreshEvery: 5 })
    await nextTick()
    expect(changed).toHaveBeenCalledTimes(1)
    setEink({ on: false })
    await nextTick()
    expect(el.classList.contains(EINK_CLASS)).toBe(false)
    stop()
    setEink({ on: true })
    await nextTick()
    expect(el.classList.contains(EINK_CLASS)).toBe(false)
  })

  it('starts with the class when the mode is already on', () => {
    setEink({ on: true })
    const el = document.createElement('div')
    followEink(el, () => {})()
    expect(el.classList.contains(EINK_CLASS)).toBe(true)
    setEink({ on: false })
  })
})

describe('the app on an e-ink device', () => {
  beforeEach(() => initEink({ loadLocalStorage: () => null, saveLocalStorage: () => {} }))

  it('marks the body while the mode is on, so the quick button holds still too', async () => {
    const body = document.createElement('body')
    const stop = followEink(body, () => {}, EINK_BODY_CLASS)
    setEink({ on: true })
    await nextTick()
    expect(body.classList.contains(EINK_BODY_CLASS)).toBe(true)
    expect(body.classList.contains(EINK_CLASS)).toBe(false)
    setEink({ on: false })
    await nextTick()
    expect(body.classList.contains(EINK_BODY_CLASS)).toBe(false)
    stop()
    body.classList.remove(EINK_BODY_CLASS)
  })
})
