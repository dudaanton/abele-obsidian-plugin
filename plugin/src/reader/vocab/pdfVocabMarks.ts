import { dottedLines } from '../linkMarks'
import { findWords, type WordMatch } from './words'
import { formTable, type VocabRule } from './rules'
import { offsetOf, rangeOf, sectionText, type SectionText } from './sectionText'

const SVG = 'http://www.w3.org/2000/svg'
const XHTML = 'http://www.w3.org/1999/xhtml'
const BUDGET = 4000
const MEASURE_BUDGET = 200
const CACHE_SIZE = 8
const nextTask = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0))

interface Page {
  doc: Document
  index: number
  text: SectionText
  matches: WordMatch[]
  drawn: {
    match: WordMatch
    rects: { left: number; right: number; top: number; bottom: number }[]
  }[]
  own: Map<string, [number, number]>
  revision: number
}

/** One live record per rendered PDF page; only numeric positions survive an unmount. */
export class PdfVocabMarks {
  private table = new Map<string, VocabRule[]>()
  private signature = ''
  private generation = 0
  private pages = new Map<Document, Page>()
  private kept = new Map<number, { text: string; signature: string; matches: WordMatch[] }>()
  private highlights = new Map<number, VocabRule[]>()
  private stopped = false

  constructor(
    private readonly contents: () => { doc?: Document }[],
    private readonly color: () => string,
    private readonly place: (cfi: string, index: number, doc: Document) => Range | null,
    private readonly indexOf: (cfi: string) => number = () => -1
  ) {}

  setRules(rules: VocabRule[]): void {
    if (this.stopped) return
    const table = formTable(rules)
    const signature = [...table.keys()].sort().join('\n')
    const changed = signature !== this.signature
    this.table = table
    this.signature = signature
    this.highlights.clear()
    for (const rule of rules) {
      if (rule.target.kind !== 'highlight') continue
      const index = this.indexOf(rule.target.cfi)
      const list = this.highlights.get(index) ?? []
      list.push(rule)
      this.highlights.set(index, list)
    }
    this.generation++
    if (changed) {
      this.kept.clear()
      for (const page of this.pages.values()) {
        page.matches = []
        page.drawn = []
        page.doc.documentElement.querySelector(':scope > .abele-vocab-marks')?.remove()
      }
    }
    if (!table.size) {
      for (const page of this.pages.values()) {
        page.matches = []
        page.drawn = []
        page.doc.documentElement.querySelector(':scope > .abele-vocab-marks')?.remove()
      }
      return
    }
    for (const page of this.pages.values()) {
      if (changed || !page.matches.length) void this.scan(page)
      else {
        page.own = this.ownPlaces(page)
        this.paint(page)
      }
    }
  }

  rules(): VocabRule[] {
    return [...new Set([...this.table.values()].flat())]
  }

  count(): number {
    return [...this.pages.values()].reduce((n, p) => n + p.matches.length, 0)
  }

  private live(page: Page, revision: number, generation: number): boolean {
    return (
      !this.stopped &&
      this.generation === generation &&
      page.revision === revision &&
      this.pages.get(page.doc) === page &&
      this.contents().some((c) => c.doc === page.doc)
    )
  }

  /** PDF.js replaces every text node on a zoom, even if the document is unchanged. */
  pageDrawn(doc: Document, index: number): void {
    if (this.stopped || !this.contents().some((c) => c.doc === doc)) return
    for (const page of this.pages.values())
      if (page.index === index && page.doc !== doc) this.pageUnloaded(page.doc)
    const old = this.pages.get(doc)
    const text = sectionText(doc, doc.querySelector('.textLayer'))
    const page: Page = {
      doc,
      index,
      text,
      matches: [],
      drawn: [],
      own: new Map(),
      revision: (old?.revision ?? 0) + 1,
    }
    this.pages.set(doc, page)
    const kept =
      old?.text.text === text.text && old.matches.length
        ? { text: text.text, signature: this.signature, matches: old.matches }
        : this.kept.get(index)
    if (!this.table.size) return
    if (kept?.text === text.text && kept.signature === this.signature) {
      page.matches = kept.matches
      page.own = this.ownPlaces(page)
      this.paint(page)
    } else void this.scan(page)
  }

  private async scan(page: Page): Promise<void> {
    const generation = this.generation
    const revision = page.revision
    const keys = new Set(this.table.keys())
    const matches: WordMatch[] = []
    if (keys.size) {
      let from = 0
      while (from >= 0) {
        const result = findWords(page.text.text, keys, from, BUDGET)
        matches.push(...result.matches)
        from = result.next
        if (from < 0) break
        await nextTask()
        if (!this.live(page, revision, generation)) return
      }
    }
    if (!this.live(page, revision, generation)) return
    page.matches = matches
    page.own = this.ownPlaces(page)
    this.kept.delete(page.index)
    this.kept.set(page.index, { text: page.text.text, signature: this.signature, matches })
    while (this.kept.size > CACHE_SIZE) this.kept.delete(this.kept.keys().next().value!)
    this.paint(page)
  }

  private ownPlaces(page: Page): Map<string, [number, number]> {
    const own = new Map<string, [number, number]>()
    for (const rule of this.highlights.get(page.index) ?? []) {
      if (rule.target.kind !== 'highlight') continue
      const range = this.place(rule.target.cfi, page.index, page.doc)
      if (range)
        own.set(rule.id, [
          offsetOf(page.text, range.startContainer, range.startOffset),
          offsetOf(page.text, range.endContainer, range.endOffset),
        ])
    }
    return own
  }

  private rulesOf(page: Page, match: WordMatch): VocabRule[] {
    return (this.table.get(match.key) ?? []).filter((rule) => {
      const own = page.own.get(rule.id)
      return !own || match.start < own[0] || match.end > own[1]
    })
  }

  private async paint(page: Page): Promise<void> {
    if (!page.matches.length) {
      page.drawn = []
      page.doc.documentElement.querySelector(':scope > .abele-vocab-marks')?.remove()
      return
    }
    const generation = this.generation
    const revision = page.revision
    const root = page.doc.documentElement
    const base = root.getBoundingClientRect()
    const scale = base.width ? root.offsetWidth / base.width : 1
    const layer = page.doc.createElementNS(XHTML, 'div')
    layer.className = 'abele-vocab-marks'
    layer.setAttribute('aria-hidden', 'true')
    Object.assign(layer.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '0',
      height: '0',
      pointerEvents: 'none',
    })
    const svg = page.doc.createElementNS(SVG, 'svg')
    svg.setAttribute('width', String(root.offsetWidth))
    svg.setAttribute('height', String(root.offsetHeight))
    svg.setAttribute('viewBox', `0 0 ${root.offsetWidth} ${root.offsetHeight}`)
    Object.assign(svg.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      overflow: 'visible',
      pointerEvents: 'none',
    })
    layer.append(svg)
    const drawn: Page['drawn'] = []
    const seen = new Set<string>()
    for (let i = 0; i < page.matches.length; i++) {
      if (i && i % MEASURE_BUDGET === 0) {
        await nextTask()
        if (!this.live(page, revision, generation)) return
      }
      const match = page.matches[i]
      if (!this.rulesOf(page, match).length) continue
      const range = rangeOf(page.text, match.start, match.end)
      if (!range) continue
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0)
      if (!rects.length) continue
      const local = rects.map((r) => ({
        left: (r.left - base.left) * scale,
        right: (r.right - base.left) * scale,
        top: (r.top - base.top) * scale,
        bottom: (r.bottom - base.top) * scale,
        width: r.width * scale,
      }))
      drawn.push({ match, rects: local })
      for (const r of local) {
        const key = `${r.left}:${r.right}:${r.bottom}`
        if (seen.has(key)) continue
        seen.add(key)
        // dottedLines creates in the host document; SVG nodes are adopted into the page.
        const lines = dottedLines([r as DOMRect], this.color(), 'abele-vocab-mark')
        for (const line of Array.from(lines.querySelectorAll('line'))) {
          line.setAttribute('stroke-width', String(2 * scale))
          line.setAttribute('stroke-dasharray', `${0.1 * scale} ${4 * scale}`)
        }
        svg.append(lines)
      }
    }
    if (!this.live(page, revision, generation)) return
    root.querySelector(':scope > .abele-vocab-marks')?.replaceWith(layer)
    if (!layer.isConnected) root.append(layer)
    page.drawn = drawn
  }

  redraw(): void {
    for (const page of this.pages.values()) if (this.table.size) void this.paint(page)
  }

  at(doc: Document, x: number, y: number): { rules: VocabRule[]; rect: DOMRect } | null {
    const page = this.pages.get(doc)
    if (!page || !this.contents().some((c) => c.doc === doc)) return null
    // Stored page coordinates stretch with the live frame; no word is remeasured on a tap.
    const root = doc.documentElement
    const base = root.getBoundingClientRect()
    const horizontal = root.offsetWidth ? base.width / root.offsetWidth : 1
    const vertical = root.offsetHeight ? base.height / root.offsetHeight : horizontal
    for (const { match, rects } of page.drawn) {
      for (const local of rects) {
        const rect = {
          left: base.left + local.left * horizontal,
          right: base.left + local.right * horizontal,
          top: base.top + local.top * vertical,
          bottom: base.top + local.bottom * vertical,
        } as DOMRect
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom + 4) {
          const rules = this.rulesOf(page, match)
          if (rules.length) return { rules, rect }
        }
      }
    }
    return null
  }

  pageUnloaded(doc: Document): void {
    const page = this.pages.get(doc)
    if (!page) return
    page.revision++
    doc.documentElement.querySelector(':scope > .abele-vocab-marks')?.remove()
    this.pages.delete(doc)
  }

  reconcile(): void {
    for (const doc of this.pages.keys())
      if (!this.contents().some((c) => c.doc === doc)) this.pageUnloaded(doc)
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.generation++
    for (const doc of this.pages.keys()) this.pageUnloaded(doc)
    this.kept.clear()
  }
}
