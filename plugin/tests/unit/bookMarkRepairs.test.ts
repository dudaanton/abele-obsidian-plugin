import { describe, expect, it, vi } from 'vitest'
import { pageOf } from '../helpers/pageDocument'
import { findQuote } from '@/reader/bookQuote'
import { BookMarks } from '@/reader/marks'
import type { Highlight } from '@/reader/highlights'
import { fromRange, parse, toRange } from '@/vendor/foliate-js/epubcfi.js'

vi.mock('@/reader/vocab/vocabMarks', () => ({ VocabMarks: class { redraw() {} } }))
const h = (cfi: string, text: string): Highlight => ({ cfi, text, color: 'yellow', comment: '', label: 'Part' })
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

describe('known misplaced marks', () => {
  it('keeps the stored annotation identity, proposes a verified destination only once, and invalidates quote edits', async () => {
    const doc = pageOf('<p>Ordinary opening sentence.</p><p>Fabricated later sentence.</p>')
    const old = fromRange(findQuote(doc, 'Ordinary opening sentence.')[0])
    const expected = fromRange(findQuote(doc, 'Fabricated later sentence.')[0])
    const added = vi.fn(async () => {})
    const engine = new EventTarget() as EventTarget & Record<string, unknown>
    engine.renderer = { getContents: () => [{ index: 0, doc }] }
    engine.resolveNavigation = (cfi: string) => ({ index: 0, anchor: (d: Document) => toRange(d, parse(cfi)) })
    engine.getCFI = (_: number, r: Range) => fromRange(r)
    engine.addAnnotation = added
    engine.deleteAnnotation = vi.fn(async () => {})
    const marks = new BookMarks(engine as never, document.body, false, () => {})
    const changed = vi.fn()
    marks.onRepairsChanged = changed
    marks.set([h(old, 'Fabricated later sentence.')])
    await flush()
    expect(added).toHaveBeenCalledWith({ value: old, cfi: expected })
    expect(marks.repairs()).toMatchObject([{ cfi: old, suggested: expected }])
    marks.redraw()
    await flush()
    expect(changed).toHaveBeenCalledTimes(1)
    engine.renderer = { getContents: () => [] }
    marks.redraw()
    await flush()
    expect(marks.repairs()).toMatchObject([{ cfi: old, suggested: expected }])
    engine.renderer = { getContents: () => [{ index: 0, doc }] }
    marks.set([h(old, 'Ordinary opening sentence.')])
    await flush()
    expect(marks.repairs()).toEqual([])
    marks.set([])
    expect(marks.repairs()).toEqual([])
  })
})
