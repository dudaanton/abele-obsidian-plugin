/**
 * Find in a GitHub tab — what Cmd+F does in a note, for a view Obsidian's own search does not
 * reach.
 *
 * A tab holds three kinds of text, and each is searched where it really is:
 *
 * - comments, descriptions, headers: the page's own text nodes, marked with the CSS Custom
 *   Highlight API, which paints ranges without touching the DOM Vue owns;
 * - code and diffs: CodeMirror draws only the lines on screen, so its DOM is not the text — its
 *   document is. Those are searched in the document and marked with decorations;
 * - a diff file that is folded shut is not drawn at all. Its text is the same the viewer would
 *   show, so it is searched from the data, and opened when a match inside it becomes current.
 *
 * The matches run in the order they are on the page, so next and previous walk down and up it.
 */
import { EditorView } from '@codemirror/view'
import { compileQuery, matchRanges } from '../search/textSearch'
import { pinIntoView, type Locate } from '../scrollTo'
import { markFind } from './cmMarks'

type Ranges = Array<[number, number]>

interface TextRun {
  kind: 'text'
  /** The text nodes of one stretch of page, in order, with where each starts in `text`. */
  nodes: Array<{ node: Text; start: number }>
  text: string
  ranges: Ranges
}

interface CodeRun {
  kind: 'code'
  view: EditorView
  ranges: Ranges
}

interface FoldedRun {
  kind: 'folded'
  /** The diff file's section, whose head opens it. */
  section: HTMLElement
  ranges: Ranges
}

type Run = TextRun | CodeRun | FoldedRun

export interface FinderHooks {
  /** The text a folded diff file would show, by its `data-diff` hash; null when unknown. */
  foldedText(hash: string): string | null
}

/** Inline elements: text inside one continues the sentence, it does not start a new one. */
const INLINE = new Set([
  'A',
  'ABBR',
  'B',
  'CODE',
  'DEL',
  'EM',
  'I',
  'INS',
  'KBD',
  'MARK',
  'S',
  'SMALL',
  'SPAN',
  'STRONG',
  'SUB',
  'SUP',
  'U',
])

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SVG', 'svg', 'TEMPLATE'])

/** Marks an element find leaves out — the find bar itself, the code search panel. */
export const FIND_SKIP_ATTR = 'data-find-skip'

const MATCH = 'abele-find'
const CURRENT = 'abele-find-current'

interface HighlightMap {
  set(name: string, value: unknown): void
  get(name: string): unknown
  delete(name: string): void
}

type HighlightCtor = new (...ranges: Range[]) => unknown

export class TabFinder {
  private runs: Run[] = []
  /** Every match as [run, index into its ranges], page order. */
  private flat: Array<[number, number]> = []
  private index = -1
  private query = ''
  private caseSensitive = false
  private highlights: { all: unknown; current: unknown } | null = null
  private unpin = () => {}
  private observer: MutationObserver | null = null
  private refreshTimer = 0

  constructor(
    private readonly root: HTMLElement,
    private readonly hooks: FinderHooks,
    private readonly onChange: () => void = () => {}
  ) {}

  get count(): number {
    return this.flat.length
  }

  /** 0-based; -1 when there is none. */
  get current(): number {
    return this.index
  }

  /** Searches the tab afresh and makes the first match at or after the old current one current. */
  search(query: string, caseSensitive: boolean): number {
    const keep = this.query === query && this.caseSensitive === caseSensitive ? this.index : 0
    this.query = query
    this.caseSensitive = caseSensitive
    this.collect()
    this.index = this.flat.length ? Math.min(Math.max(keep, 0), this.flat.length - 1) : -1
    this.paint()
    this.watch()
    this.onChange()
    return this.flat.length
  }

  /** Moves to the next or previous match, wrapping around, and scrolls to it. */
  async move(delta: 1 | -1): Promise<void> {
    if (!this.flat.length) return
    this.index = (this.index + delta + this.flat.length) % this.flat.length
    await this.reveal()
  }

  /**
   * Scrolls to the current match, opening its diff file first if it is folded — unless `unfold`
   * is off, as while the query is still being typed: then a folded match is left where it is.
   */
  async reveal(unfold = true): Promise<void> {
    if (this.index < 0) return
    const run = this.runs[this.flat[this.index][0]]
    if (run.kind === 'folded') {
      if (!unfold) return
      await this.unfold(run.section)
      this.collect()
      this.index = Math.min(this.index, this.flat.length - 1)
    }
    this.paint()
    this.onChange()
    const now = this.runs[this.flat[this.index]?.[0]]
    if (!now) return
    this.unpin()
    this.unpin = pinIntoView(this.root, this.locate(now, this.flat[this.index][1]), {
      context: 96,
    })
  }

  clear(): void {
    this.query = ''
    this.runs.forEach((run) => {
      if (run.kind === 'code') markFind(run.view, { ranges: [], current: -1 })
    })
    this.runs = []
    this.flat = []
    this.index = -1
    this.dropHighlights()
    this.observer?.disconnect()
    this.observer = null
    ;(this.root.ownerDocument.defaultView ?? window).clearTimeout(this.refreshTimer)
    this.unpin()
    this.onChange()
  }

  private collect(): void {
    this.runs = []
    if (!this.query) {
      this.flat = []
      return
    }
    const re = compileQuery({ text: this.query, caseSensitive: this.caseSensitive })
    let text: TextRun | null = null
    let lastParent: Element | null = null

    const flushText = () => {
      if (text && text.text) {
        text.ranges = matchRanges(text.text, re)
        this.runs.push(text)
      }
      text = null
      lastParent = null
    }

    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node as Text
        if (!t.data.trim()) return
        const parent = t.parentElement
        text ??= { kind: 'text', nodes: [], text: '', ranges: [] }
        // A new block starts a new line, so a match never runs from one paragraph into the next.
        if (lastParent && parent !== lastParent && !(parent && INLINE.has(parent.tagName))) {
          text.text += '\n'
        }
        text.nodes.push({ node: t, start: text.text.length })
        text.text += t.data
        lastParent = parent
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      const el = node as HTMLElement
      if (SKIP.has(el.tagName) || el.hasAttribute(FIND_SKIP_ATTR)) return
      if (el.classList.contains('cm-editor')) {
        const view = EditorView.findFromDOM(el)
        if (view) {
          flushText()
          this.runs.push({ kind: 'code', view, ranges: matchRanges(view.state.doc.toString(), re) })
        }
        return
      }
      for (const child of Array.from(el.childNodes)) walk(child)
      const hash = el.getAttribute('data-diff')
      if (hash && el.querySelector(':scope > [aria-expanded="false"]')) {
        const folded = this.hooks.foldedText(hash)
        if (folded) {
          flushText()
          this.runs.push({ kind: 'folded', section: el, ranges: matchRanges(folded, re) })
        }
      }
    }

    walk(this.root)
    flushText()
    this.flat = []
    this.runs.forEach((run, r) => run.ranges.forEach((_, i) => this.flat.push([r, i])))
  }

  private paint(): void {
    const [curRun, curIndex] = this.index >= 0 ? this.flat[this.index] : [-1, -1]
    const all: Range[] = []
    const current: Range[] = []
    this.runs.forEach((run, r) => {
      if (run.kind === 'code') {
        markFind(run.view, { ranges: run.ranges, current: r === curRun ? curIndex : -1 })
      } else if (run.kind === 'text') {
        run.ranges.forEach((range, i) => {
          const dom = this.domRange(run, range)
          if (dom) (r === curRun && i === curIndex ? current : all).push(dom)
        })
      }
    })
    this.setHighlights(all, current)
  }

  private domRange(run: TextRun, [from, to]: [number, number]): Range | null {
    const at = (offset: number, end: boolean) => {
      let found = run.nodes[0]
      for (const n of run.nodes) {
        if (n.start < offset || (!end && n.start === offset)) found = n
        else break
      }
      return { node: found.node, offset: Math.min(offset - found.start, found.node.data.length) }
    }
    const a = at(from, false)
    const b = at(to, true)
    if (!a.node.isConnected || !b.node.isConnected) return null
    const range = this.root.ownerDocument.createRange()
    try {
      range.setStart(a.node, Math.max(0, a.offset))
      range.setEnd(b.node, Math.max(0, b.offset))
    } catch {
      return null
    }
    return range
  }

  private registry(): { reg: HighlightMap; Highlight: HighlightCtor } | null {
    // Missing on an older phone WebView: the count still works, the page just is not painted.
    const win = this.root.ownerDocument.defaultView as unknown as {
      CSS?: { highlights?: HighlightMap }
      Highlight?: HighlightCtor
    } | null
    const reg = win?.CSS?.highlights
    const Highlight = win?.Highlight
    return reg && Highlight ? { reg, Highlight } : null
  }

  private setHighlights(all: Range[], current: Range[]): void {
    const api = this.registry()
    if (!api) return
    this.highlights = { all: new api.Highlight(...all), current: new api.Highlight(...current) }
    api.reg.set(MATCH, this.highlights.all)
    api.reg.set(CURRENT, this.highlights.current)
  }

  /** Only this finder's own: another tab's search in the same window is left alone. */
  private dropHighlights(): void {
    const api = this.registry()
    if (api && this.highlights) {
      if (api.reg.get(MATCH) === this.highlights.all) api.reg.delete(MATCH)
      if (api.reg.get(CURRENT) === this.highlights.current) api.reg.delete(CURRENT)
    }
    this.highlights = null
  }

  private locate(run: Run, i: number): Locate {
    if (run.kind === 'code') {
      const view = run.view
      const pos = run.ranges[i]?.[0] ?? 0
      return () => {
        if (!view.dom.isConnected || view.dom.getClientRects().length === 0) return null
        const drawn = pos >= view.viewport.from && pos <= view.viewport.to
        const rect = drawn ? view.coordsAtPos(pos) : null
        if (rect) return rect.top
        return { estimate: view.documentTop + view.lineBlockAt(pos).top }
      }
    }
    if (run.kind === 'text') {
      const range = run.ranges[i]
      return () => {
        const dom = this.domRange(run, range)
        const rect = dom?.getBoundingClientRect()
        return rect && (rect.height || rect.width) ? rect.top : null
      }
    }
    return () => null
  }

  /** Opens a folded diff file with its own head, and waits for its viewer to be drawn. */
  private async unfold(section: HTMLElement): Promise<void> {
    const head = section.querySelector<HTMLElement>(':scope > [aria-expanded="false"]')
    head?.click()
    const win = this.root.ownerDocument.defaultView ?? window
    for (let i = 0; i < 40; i++) {
      if (section.querySelector('.cm-editor')) return
      await new Promise((resolve) => win.setTimeout(resolve, 25))
    }
  }

  /**
   * Searches again when the tab's content changes — a section loads, a file opens — so the count
   * stays true. What CodeMirror redraws inside itself is its own business and is ignored.
   */
  private watch(): void {
    if (this.observer || typeof MutationObserver === 'undefined') return
    this.observer = new MutationObserver((records) => {
      const relevant = records.some((r) => {
        const el =
          r.target.nodeType === Node.ELEMENT_NODE ? (r.target as Element) : r.target.parentElement
        return el && !el.closest('.cm-editor') && !el.closest(`[${FIND_SKIP_ATTR}]`)
      })
      if (!relevant || !this.query) return
      const win = this.root.ownerDocument.defaultView ?? window
      win.clearTimeout(this.refreshTimer)
      this.refreshTimer = win.setTimeout(() => this.search(this.query, this.caseSensitive), 250)
    })
    this.observer.observe(this.root, { childList: true, subtree: true, characterData: true })
  }
}
