/**
 * How far the page moves under a selection carried on (`src/reader/selectionStep.ts`): half a
 * page, never a whole one, and pages again once the selection is let go.
 */
import { describe, it, expect, vi } from 'vitest'
import { SelectionStep, STEP, type StepRenderer } from '@/reader/selectionStep'

/** The engine's page element: pages of `columns` columns 400 wide, or a scrolled chapter. */
function engine(opts: { columns?: number; scrolled?: boolean; start?: number } = {}) {
  const r = Object.assign(new EventTarget(), {
    scrolled: !!opts.scrolled,
    columns: opts.columns ?? 1,
    size: 400,
    start: opts.start ?? 800,
    end: (opts.start ?? 800) + 400,
    pages: 8,
    viewSize: 4000,
    keep: false,
    relocate: () => r.dispatchEvent(new Event('relocate')),
    next: vi.fn(async (d?: number) => {
      r.start += d ?? 400
      r.relocate()
    }),
    prev: vi.fn(async (d?: number) => {
      r.start -= d ?? 400
      r.relocate()
    }),
    stepBy: vi.fn(async (d: number) => {
      r.start += d
      r.relocate()
    }),
    showAnchor: vi.fn(async () => r.relocate()),
    setFlow: vi.fn((flow: string, _anchor?: Range, keep?: boolean) => {
      r.scrolled = flow === 'scrolled'
      r.keep = !!keep
      r.relocate()
    }),
    hasAttribute: (name: string) => name === 'data-keep' && r.keep,
  })
  return r
}

const at = () => document.createRange()

describe('the page moved on under a selection', () => {
  it('moves pages of two columns by one column: half a page, every line whole', async () => {
    const r = engine({ columns: 2 })
    const step = new SelectionStep(() => r as StepRenderer)
    expect(await step.step(1, at())).toBe(true)
    expect(r.stepBy).toHaveBeenCalledWith(400 * STEP)
    expect(r.next).not.toHaveBeenCalled()
    await step.step(-1, at())
    expect(r.stepBy).toHaveBeenLastCalledWith(-400 * STEP)
  })

  it('scrolls a chapter of one column for now, where its page was, and moves half a screen', async () => {
    const r = engine({ columns: 1 })
    const step = new SelectionStep(() => r as StepRenderer)
    const from = at()
    expect(await step.step(1, from)).toBe(true)
    expect(r.setFlow).toHaveBeenCalledWith('scrolled', from, true)
    expect(step.temporary).toBe(true)
    expect(r.next).toHaveBeenCalledWith(400 * STEP)
    // Already scrolled: the next step only scrolls.
    await step.step(1, at())
    expect(r.setFlow).toHaveBeenCalledTimes(1)
    expect(r.next).toHaveBeenCalledTimes(2)
  })

  it('once the selection is let go, brings the pages back, on the page where it ended', async () => {
    const r = engine({ columns: 1 })
    const step = new SelectionStep(() => r as StepRenderer)
    await step.step(1, at())
    const end = at()
    await step.settle(end)
    expect(r.setFlow).toHaveBeenLastCalledWith('paginated', end, false)
    expect(step.temporary).toBe(false)
    expect(r.scrolled).toBe(false)
  })

  it('moves a chapter the reader scrolls anyway by half a screen, and leaves it there', async () => {
    const r = engine({ scrolled: true, start: 0 })
    const step = new SelectionStep(() => r as StepRenderer)
    await step.step(1, at())
    expect(r.next).toHaveBeenCalledWith(400 * STEP)
    expect(r.setFlow).not.toHaveBeenCalled()
    await step.settle(at())
    expect(r.setFlow).not.toHaveBeenCalled()
    expect(r.showAnchor).not.toHaveBeenCalled()
  })

  it('puts pages moved by a column back on a page’s edge, and leaves ones already there', async () => {
    const r = engine({ columns: 2, start: 1000 })
    const step = new SelectionStep(() => r as StepRenderer)
    const end = at()
    await step.settle(end)
    expect(r.showAnchor).toHaveBeenCalledWith(end)
    r.start = 1200
    await step.settle(end)
    expect(r.showAnchor).toHaveBeenCalledTimes(1)
  })

  it('knows the ends of the chapter: its first and last text pages, or the ends of the scroll', () => {
    const r = engine({ columns: 2, start: 400 })
    const step = new SelectionStep(() => r as StepRenderer)
    expect(step.atEdge(-1)).toBe(true)
    expect(step.atEdge(1)).toBe(false)
    r.start = 6 * 400
    expect(step.atEdge(1)).toBe(true)
    const s = engine({ scrolled: true, start: 0 })
    const scroll = new SelectionStep(() => s as StepRenderer)
    expect(scroll.atEdge(-1)).toBe(true)
    s.start = 3600
    s.end = 4000
    expect(scroll.atEdge(1)).toBe(true)
  })
})
