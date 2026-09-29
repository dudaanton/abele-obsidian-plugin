import { describe, expect, it, vi } from 'vitest'
import { PdfVocabMarks } from '@/reader/vocab/pdfVocabMarks'
import { BookMarks } from '@/reader/marks'
import { ruleOfNote } from '@/reader/vocab/rules'

const rule = ruleOfNote('sample-note.md', {
  forms: ['sample'],
  language: '',
  books: [],
  scope: 'book',
  on: true,
})
const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

function page(html = '<span>sam</span><span>ple</span> <span>sample</span>') {
  const doc = document.implementation.createHTMLDocument('page')
  const layer = doc.createElement('div')
  layer.className = 'textLayer'
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  layer.append(...Array.from(parsed.body.childNodes, (node) => doc.importNode(node, true)))
  doc.body.append(layer)
  const annotation = doc.createElement('div')
  annotation.className = 'annotationLayer'
  annotation.textContent = 'sample'
  doc.body.append(annotation)
  return doc
}

describe('PDF vocabulary pages', () => {
  it('finds split words only inside the live text layer, and drops them on unload', async () => {
    const doc = page()
    let contents: { doc: Document }[] = [{ doc }]
    const marks = new PdfVocabMarks(
      () => contents,
      () => 'purple',
      () => null
    )
    marks.setRules([rule])
    marks.pageDrawn(doc, 0)
    await tick()
    expect(marks.count()).toBe(2)
    expect(doc.querySelectorAll('.abele-vocab-marks')).toHaveLength(1)
    contents = []
    marks.pageUnloaded(doc)
    expect(marks.count()).toBe(0)
    expect(doc.querySelector('.abele-vocab-marks')).toBeNull()
    marks.stop()
  })

  it('removes drawn lines immediately when the last form is disabled, even on dense pages', async () => {
    const doc = page(`<span>${'sample '.repeat(250)}</span>`)
    const marks = new PdfVocabMarks(
      () => [{ doc }],
      () => 'purple',
      () => null
    )
    marks.setRules([rule])
    marks.pageDrawn(doc, 0)
    await tick()
    expect(doc.querySelector('.abele-vocab-marks')).not.toBeNull()
    marks.setRules([{ ...rule, keys: ['other'], forms: ['other'] }])
    expect(doc.querySelector('.abele-vocab-marks')).toBeNull()
    marks.setRules([])
    expect(doc.querySelector('.abele-vocab-marks')).toBeNull()
    expect(marks.at(doc, 10, 10)).toBeNull()
    marks.stop()
  })

  it('keeps page-local hits aligned through an intermediate scale without remeasuring words on tap', async () => {
    const doc = page('<span>sample</span>')
    const root = doc.documentElement
    Object.defineProperty(root, 'offsetWidth', { value: 300 })
    Object.defineProperty(root, 'offsetHeight', { value: 400 })
    let origin = 20
    let width = 100
    vi.spyOn(root, 'getBoundingClientRect').mockImplementation(
      () => ({ left: origin, top: 30, width, height: 200 }) as DOMRect
    )
    const rects = vi
      .spyOn(Range.prototype, 'getClientRects')
      .mockImplementation(
        () =>
          [
            { left: 30, right: 50, top: 40, bottom: 50, width: 20, height: 10 },
          ] as unknown as DOMRectList
      )
    try {
      const marks = new PdfVocabMarks(
        () => [{ doc }],
        () => 'purple',
        () => null
      )
      marks.setRules([rule])
      marks.pageDrawn(doc, 0)
      await tick()
      const line = doc.querySelector('.abele-vocab-mark line')!
      expect(line.getAttribute('x1')).toBe('31')
      expect(line.getAttribute('stroke-width')).toBe('6')
      const measured = rects.mock.calls.length
      expect(marks.at(doc, 35, 45)?.rules).toEqual([rule])
      origin = 40
      width = 150
      expect(marks.at(doc, 60, 50)?.rules).toEqual([rule])
      expect(marks.at(doc, 35, 45)).toBeNull()
      expect(rects).toHaveBeenCalledTimes(measured)
      marks.stop()
    } finally {
      rects.mockRestore()
    }
  })

  it('ignores a departed frame drawing after its replacement through BookMarks.pageDrawn', async () => {
    const old = page('<span>sample</span>')
    const replacement = page('<span>sample</span>')
    // Mounted frames have a defaultView; detached happy-dom documents do not.
    Object.defineProperty(old, 'defaultView', { value: window, configurable: true })
    Object.defineProperty(replacement, 'defaultView', { value: window, configurable: true })
    const contents: { doc: Document }[] = [{ doc: old }]
    const engine = { renderer: { getContents: () => contents } } as unknown as ConstructorParameters<typeof BookMarks>[0]
    const marks = new BookMarks(engine, document.body, true, () => {}, true)
    marks.vocab!.setRules([rule])
    marks.pageDrawn(old, 0)
    await tick()
    contents[0] = { doc: replacement }
    marks.pageDrawn(replacement, 0)
    await tick()
    expect(marks.vocab!.count()).toBe(1)
    marks.pageDrawn(old, 0)
    expect(marks.vocab!.count()).toBe(1)
    expect(replacement.querySelector('.abele-vocab-marks')).not.toBeNull()
    expect((marks as unknown as { pdfDocs: Map<number, Document> }).pdfDocs.get(0)).toBe(replacement)
    marks.destroy()
  })

  it('keeps both pages of a spread and rejects a late draw after removal', async () => {
    const first = page('<span>sample</span>')
    const second = page('<span>sample</span>')
    const contents = [{ doc: first }, { doc: second }]
    const marks = new PdfVocabMarks(
      () => contents,
      () => 'purple',
      () => null
    )
    marks.setRules([rule])
    marks.pageDrawn(second, 1)
    marks.pageDrawn(first, 0)
    await tick()
    expect(marks.count()).toBe(2)
    contents.splice(0, 1)
    marks.pageUnloaded(first)
    marks.pageDrawn(first, 0)
    expect(marks.count()).toBe(1)
    marks.stop()
  })

  it('invalidates pending words on rule removal and rebuilds the same document on redraw', async () => {
    const doc = page()
    const marks = new PdfVocabMarks(
      () => [{ doc }],
      () => 'purple',
      () => null
    )
    marks.setRules([rule])
    marks.pageDrawn(doc, 0)
    marks.setRules([])
    await tick()
    expect(marks.count()).toBe(0)
    marks.setRules([rule])
    doc.querySelector('.textLayer')!.innerHTML = '<span>sample sample sample</span>'
    marks.pageDrawn(doc, 0)
    await tick()
    expect(marks.count()).toBe(3)
    marks.stop()
  })
})
