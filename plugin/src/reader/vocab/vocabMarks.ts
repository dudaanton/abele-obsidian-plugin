/**
 * Words that vocabulary rules name, underlined wherever they are in the open book — the dotted
 * line of words a note links to — and found again under a tap.
 *
 * Each chapter's text is read once when its page is made (`sectionText.ts`), a piece at a time so
 * a long chapter does not hold up the page, and the words the rules name are kept as places in
 * that text: no ranges, nothing measured. The last few chapters' are kept, so going back and
 * forth reads nothing again; a change of the forms reads them again.
 *
 * Only the words on screen, and about a page of text either side, are drawn: a chapter can be
 * dozens of pages, a word can be on every line, and measuring all of it on each page turn would
 * slow the turn. They are drawn as one mark of the engine's on the chapter's overlay, whose range
 * is empty — so the engine's own tap test never finds it and a highlight under the words still
 * answers as before — and whose drawing works out what is on screen each time it is drawn. The
 * engine draws its marks again whenever the page changes: its size, its place (`keepMarksOnText`
 * after each turn), its fonts, a picture, the iPhone's relayout, the theme, e-ink. So the words
 * drawn follow the page without anything of their own.
 */
import type { View as FoliateView } from '@/vendor/foliate-js/view.js'
import { dottedLines } from '../linkMarks'
import { findWords, type WordMatch } from './words'
import { offsetOf, rangeOf, sectionText, type SectionText } from './sectionText'
import type { VocabRule } from './rules'

/** The key of the one mark a chapter's underlined words are drawn as. */
export const VOCAB_KEY = 'abele-vocab'

/** How many chapters' words are kept. */
const KEPT = 8
/** How many words are read before the thread is handed back. */
const BUDGET = 4000
/** How far past the text on screen words are drawn, as a share of the text on screen. */
const MARGIN = 1
/** The least text either side drawn, in characters, for a page that is mostly a picture. */
const MIN_MARGIN = 600

interface Contents {
  index: number
  doc?: Document
  overlayer?: {
    add(key: string, range: Range, draw: (rects: DOMRectList) => SVGElement): void
    remove(key: string): void
  }
}

/** A chapter's words found, and what is drawn of them now. */
interface Section {
  index: number
  doc: Document
  text: SectionText
  matches: WordMatch[]
  /** The words drawn last, where they are on the page, for a tap. */
  drawn: { match: WordMatch; rects: DOMRect[] }[]
  /** Where a highlight a rule belongs to is in the chapter: its own words are not underlined. */
  own: Map<string, [number, number]>
  /** Its words all found: only then are they kept for coming back to it. */
  done: boolean
}

/** A chapter's words, kept when it closes, for the same text read with the same forms. */
interface Kept {
  text: string
  keys: string
  matches: WordMatch[]
}

const nextTask = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0))

/** The first match ending after `offset`. */
function firstAfter(matches: WordMatch[], offset: number): number {
  let lo = 0
  let hi = matches.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (matches[mid].end <= offset) lo = mid + 1
    else hi = mid
  }
  return lo
}

export class VocabMarks {
  private table = new Map<string, VocabRule[]>()
  private keys = new Set<string>()
  /** The forms as one string: what a chapter's kept words were found with. */
  private signature = ''
  private sections = new Map<number, Section>()
  private kept = new Map<number, Kept>()
  /** Bumped when the forms change or the book closes: reading still going on is dropped. */
  private generation = 0
  private stopped = false

  constructor(
    private readonly engine: FoliateView,
    /** The colour the lines are drawn in, as the theme and e-ink have it now. */
    private readonly color: () => string,
    /** Where a place is on a chapter's page; null when it is in another chapter. */
    private readonly place: (cfi: string, index: number, doc: Document) => Range | null
  ) {
    engine.addEventListener('create-overlay', (e) => {
      const { index } = (e as CustomEvent<{ index: number }>).detail
      // The overlay is attached to the page once this event has been heard.
      queueMicrotask(() => void this.open(index))
    })
  }

  /** The rules that apply to the book now. */
  setRules(rules: VocabRule[]): void {
    const table = new Map<string, VocabRule[]>()
    for (const rule of rules)
      for (const key of rule.keys) {
        const list = table.get(key)
        if (!list) table.set(key, [rule])
        else if (!list.includes(rule)) list.push(rule)
      }
    this.table = table
    const signature = [...table.keys()].sort().join('\n')
    const changed = signature !== this.signature
    this.signature = signature
    this.keys = new Set(table.keys())
    if (changed) {
      this.generation++
      this.kept.clear()
      for (const section of this.sections.values()) void this.read(section.index, section.doc)
      return
    }
    // The same forms, other rules for them: the chapters' words stand, the lines are drawn again.
    for (const section of this.sections.values()) {
      section.own = this.ownPlaces(section)
      this.draw(section)
    }
  }

  /** The rules named, for the book's own reading of a chapter; every rule, for a test. */
  rules(): VocabRule[] {
    return [...new Set([...this.table.values()].flat())]
  }

  /** How many words are underlined in the chapter showing, drawn or not. */
  count(): number {
    const index = this.showing()?.index
    return index === undefined ? 0 : (this.sections.get(index)?.matches.length ?? 0)
  }

  /** The colours changed: the lines drawn again. */
  redraw(): void {
    for (const section of this.sections.values()) this.draw(section)
  }

  stop(): void {
    this.stopped = true
    this.generation++
    this.sections.clear()
    this.kept.clear()
  }

  private showing(): Contents | undefined {
    return (this.engine.renderer as unknown as { getContents(): Contents[] }).getContents()[0]
  }

  private contentsOf(index: number): Contents | undefined {
    return (this.engine.renderer as unknown as { getContents(): Contents[] })
      .getContents()
      .find((c) => c.index === index)
  }

  /** A chapter's page was made: its words found, then drawn. */
  private async open(index: number): Promise<void> {
    const doc = this.contentsOf(index)?.doc
    if (!doc || this.stopped) return
    // Chapters no longer showing: their words are kept, their pages let go.
    for (const [i, s] of this.sections)
      if (i !== index || s.doc !== doc) {
        this.keep(s)
        this.sections.delete(i)
      }
    await this.read(index, doc)
  }

  private keep(section: Section): void {
    // Left before all its words were found: read again when it is come back to.
    if (!section.done) return
    this.kept.delete(section.index)
    this.kept.set(section.index, {
      text: section.text.text,
      keys: this.signature,
      matches: section.matches,
    })
    while (this.kept.size > KEPT) this.kept.delete(this.kept.keys().next().value)
  }

  /** Finds the rules' words in a chapter's page, a piece at a time, and draws them. */
  private async read(index: number, doc: Document): Promise<void> {
    const generation = this.generation
    const text = sectionText(doc)
    const section: Section = {
      index,
      doc,
      text,
      matches: [],
      drawn: [],
      own: new Map(),
      done: false,
    }
    this.sections.set(index, section)
    const kept = this.kept.get(index)
    if (kept && kept.keys === this.signature && kept.text === text.text) {
      section.matches = kept.matches
    } else if (this.keys.size) {
      const matches: WordMatch[] = []
      let from = 0
      while (from >= 0) {
        const found = findWords(text.text, this.keys, from, BUDGET)
        for (const m of found.matches) matches.push(m)
        from = found.next
        if (from < 0) break
        await nextTask()
        if (generation !== this.generation || this.sections.get(index) !== section) return
        if (!doc.defaultView) return
      }
      section.matches = matches
    }
    if (generation !== this.generation || this.sections.get(index) !== section) return
    section.done = true
    section.own = this.ownPlaces(section)
    this.draw(section)
  }

  /** Where the highlights holding rules are in the chapter, as places in its text. */
  private ownPlaces({ index, doc, text }: Section): Map<string, [number, number]> {
    const own = new Map<string, [number, number]>()
    for (const rule of this.rules()) {
      if (rule.target.kind !== 'highlight') continue
      const range = this.place(rule.target.cfi, index, doc)
      if (!range) continue
      own.set(rule.id, [
        offsetOf(text, range.startContainer, range.startOffset),
        offsetOf(text, range.endContainer, range.endOffset),
      ])
    }
    return own
  }

  /** The rules a word found answers to: its forms', but not a highlight's at its own words. */
  private rulesOf(section: Section, match: WordMatch): VocabRule[] {
    const rules = this.table.get(match.key) ?? []
    if (!section.own.size) return rules
    return rules.filter((r) => {
      const own = section.own.get(r.id)
      return !own || match.start < own[0] || match.end > own[1]
    })
  }

  /** The chapter's mark put on its overlay again, drawn anew. */
  private draw(section: Section): void {
    const overlayer = this.contentsOf(section.index)?.overlayer
    if (!overlayer || this.contentsOf(section.index)?.doc !== section.doc) return
    if (!section.matches.length) {
      section.drawn = []
      overlayer.remove(VOCAB_KEY)
      return
    }
    // Empty: the engine's own tap test finds nothing here.
    const range = section.doc.createRange()
    overlayer.add(VOCAB_KEY, range, () => this.lines(section))
  }

  /** The part of the chapter's text on screen, with about a page either side. */
  private window(section: Section): [number, number] | null {
    const range = (this.engine as unknown as { lastLocation?: { range?: Range } | null })
      .lastLocation?.range
    if (!range || range.startContainer.ownerDocument !== section.doc) return null
    const a = offsetOf(section.text, range.startContainer, range.startOffset)
    const b = offsetOf(section.text, range.endContainer, range.endOffset)
    const margin = Math.max(MIN_MARGIN, (b - a) * MARGIN)
    return [a - margin, b + margin]
  }

  /** The lines under the words in view, measured now; what the overlay draws. */
  private lines(section: Section): SVGElement {
    const g = createSvg('g', { cls: 'abele-vocab-marks' })
    section.drawn = []
    const window = this.window(section)
    if (!window) return g
    const color = this.color()
    const { matches } = section
    for (let i = firstAfter(matches, window[0]); i < matches.length; i++) {
      const match = matches[i]
      if (match.start >= window[1]) break
      if (!this.rulesOf(section, match).length) continue
      const range = rangeOf(section.text, match.start, match.end)
      if (!range) continue
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0)
      if (!rects.length) continue
      section.drawn.push({ match, rects })
      g.append(dottedLines(rects, color, 'abele-vocab-mark'))
    }
    return g
  }

  /** The rules of the underlined word at a point of a chapter's page; none when there is none. */
  at(doc: Document, x: number, y: number): { rules: VocabRule[]; rect: DOMRect } | null {
    for (const section of this.sections.values()) {
      if (section.doc !== doc) continue
      for (const { match, rects } of section.drawn)
        for (const r of rects)
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom + 4) {
            const rules = this.rulesOf(section, match)
            if (rules.length) return { rules, rect: r }
          }
    }
    return null
  }
}
