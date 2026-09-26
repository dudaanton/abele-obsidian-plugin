/**
 * Zooming a PDF (`src/reader/pdfZoom.ts`): the limits, how far a wheel burst zooms, how sharp a
 * page is drawn within the memory a tablet has, the point kept under the fingers, two fingers
 * told from one across the page frames, and the zoom each book is remembered at.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  MAX_PAGE_PIXELS,
  MAX_ZOOM,
  MIN_ZOOM,
  PinchTracker,
  ZoomMemory,
  clampZoom,
  keepPoint,
  pinchView,
  renderRatio,
  wheelFactor,
} from '@/reader/pdfZoom'

describe('the limits of a zoom', () => {
  it('keeps a scale between a quarter and four times', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM)
    expect(clampZoom(9)).toBe(MAX_ZOOM)
    expect(clampZoom(1.5)).toBe(1.5)
    expect(clampZoom(NaN)).toBe(1)
  })
})

describe('a wheel with Ctrl, or a trackpad pinch', () => {
  it('zooms a little for a trackpad’s small steps and no more than a fifth for a mouse notch', () => {
    expect(wheelFactor(-4, 0)).toBeGreaterThan(1)
    expect(wheelFactor(-4, 0)).toBeLessThan(1.05)
    expect(wheelFactor(4, 0)).toBeLessThan(1)
    expect(wheelFactor(-120, 0)).toBeCloseTo(Math.exp(0.2), 5)
    expect(wheelFactor(3, 1)).toBeCloseTo(Math.exp(-0.2), 5)
    expect(wheelFactor(0, 0)).toBe(1)
  })
})

describe('how sharp a page is drawn', () => {
  it('takes every pixel of the screen while the page is small enough', () => {
    expect(renderRatio(1, 2, 612, 792)).toBe(2)
    expect(renderRatio(1.2, 3, 612, 792)).toBe(3)
  })

  it('draws fewer pixels than the screen has when the page would not fit in memory', () => {
    const r = renderRatio(4, 2, 612, 792)
    expect(r).toBeLessThan(2)
    const pixels = 612 * 4 * r * (792 * 4 * r)
    expect(pixels).toBeLessThanOrEqual(MAX_PAGE_PIXELS * 1.0001)
    expect(pixels).toBeGreaterThan(MAX_PAGE_PIXELS * 0.99)
  })

  it('never goes under a pixel per point of the page as it is shown', () => {
    expect(renderRatio(4, 2, 5000, 5000)).toBe(1)
  })
})

describe('the point under the fingers', () => {
  it('stays under them as two fingers spread, and moves with them', () => {
    const from: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]
    const to: typeof from = [
      { x: 60, y: 120 },
      { x: 260, y: 120 },
    ]
    const v = pinchView(1, from, to)
    expect(v.scale).toBe(2)
    // The midpoint where they started (150, 100) is drawn where their midpoint is now (160, 120).
    expect(v.x + 150 * v.scale).toBeCloseTo(160)
    expect(v.y + 100 * v.scale).toBeCloseTo(120)
    expect(v.from).toEqual({ x: 150, y: 100 })
    expect(v.to).toEqual({ x: 160, y: 120 })
  })

  it('stops at the limits, still keeping the point', () => {
    const v = pinchView(
      3,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]
    )
    expect(v.scale * 3).toBeCloseTo(MAX_ZOOM)
    expect(v.x + 5 * v.scale).toBeCloseTo(50)
  })

  it('scrolls a page laid out anew so that the same place of it is where it was asked to be', () => {
    const before = { left: 100, top: 1000, width: 600, height: 800 }
    const after = { left: 50, top: 2000, width: 1200, height: 1600 }
    // A point a quarter across and half down the page, then at (300, 200) of the screen.
    const s = keepPoint(before, { x: 250, y: 1400 }, after, { x: 300, y: 200 })
    expect(s.x).toBe(50 + 300 - 300)
    expect(s.y).toBe(2000 + 800 - 200)
  })
})

describe('two fingers across the page frames', () => {
  const tracker = () => {
    const calls: string[] = []
    const t = new PinchTracker({
      begin: () => calls.push('begin'),
      move: (from, to) => calls.push(`move ${from[0].x},${to[1].x}`),
      end: (from, to) => calls.push(`end ${from[1].x},${to[1].x}`),
    })
    return { t, calls }
  }

  it('is a pinch from the second finger to the first one lifted, whichever frame each is on', () => {
    const { t, calls } = tracker()
    expect(t.touch('start', [{ id: 1, x: 10, y: 0 }])).toBe(false)
    expect(t.touch('move', [{ id: 1, x: 12, y: 0 }])).toBe(false)
    // The second finger lands on another page, heard by another document.
    expect(t.touch('start', [{ id: 7, x: 50, y: 0 }])).toBe(true)
    expect(t.touch('move', [{ id: 7, x: 90, y: 0 }])).toBe(true)
    expect(t.pinching).toBe(true)
    t.touch('end', [{ id: 1, x: 12, y: 0 }])
    expect(t.pinching).toBe(false)
    expect(calls).toEqual(['begin', 'move 12,90', 'end 50,90'])
    // The finger left behind is not a pinch of its own.
    expect(t.touch('move', [{ id: 7, x: 95, y: 0 }])).toBe(false)
  })

  it('forgets a finger whose page was dropped from under it before it lifted', () => {
    const { t, calls } = tracker()
    let there = true
    t.touch('start', [{ id: 1, x: 0, y: 0, alive: () => there }])
    there = false
    expect(t.touch('start', [{ id: 2, x: 10, y: 0, alive: () => true }])).toBe(false)
    expect(calls).toEqual([])
  })

  it('lets a cancelled gesture go as an end', () => {
    const { t, calls } = tracker()
    t.touch('start', [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 10, y: 0 },
    ])
    t.touch('cancel', [{ id: 2, x: 10, y: 0 }])
    expect(calls).toEqual(['begin', 'end 10,10'])
  })
})

describe('the zoom each book is kept at', () => {
  const storage = () => {
    let saved: string | null = null
    return {
      load: () => saved,
      save: vi.fn((s: string | null) => (saved = s)),
    }
  }

  it('is remembered per book, and forgotten when set back to the setting', () => {
    const s = storage()
    const m = new ZoomMemory(s.load, s.save)
    m.set('a', '1.5')
    m.set('b', 'fit-page')
    const again = new ZoomMemory(s.load, s.save)
    expect(again.get('a')).toBe('1.5')
    expect(again.get('b')).toBe('fit-page')
    again.set('a', null)
    expect(new ZoomMemory(s.load, s.save).get('a')).toBeNull()
  })

  it('keeps only the books read last, and survives a damaged store', () => {
    const s = storage()
    const m = new ZoomMemory(s.load, s.save, 3)
    for (const k of ['a', 'b', 'c', 'd']) m.set(k, '2')
    m.set('b', '3')
    const again = new ZoomMemory(s.load, s.save, 3)
    expect(again.get('a')).toBeNull()
    expect(again.get('b')).toBe('3')
    expect(new ZoomMemory(() => '{oops', s.save).get('a')).toBeNull()
    expect(new ZoomMemory(() => '{"a":"evil"}', s.save).get('a')).toBeNull()
  })
})
