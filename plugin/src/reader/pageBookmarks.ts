/**
 * The bookmarks of the book open in one tab: the list its panel shows, whether the page on screen
 * has one, and marking or unmarking that page. The bookmarks themselves are the plugin's store
 * (`bookmarkFiles.ts`); a change to them from anywhere — this tab, another tab, another device —
 * is shown here as it arrives.
 */
import type { BookBookmarks, Bookmark } from './bookmarks'
import { onPage } from './bookmarks'
import { bookBookmarks } from './bookmarkFiles'
import type { BookModel } from './model'
import type { PdfBookExtras } from './pdfBook'

/** What of the engine the bookmarks need: where it is, and going somewhere. */
export interface BookmarkEngine {
  lastLocation?: {
    cfi?: string
    range?: Range | null
    index?: number
    section?: { current?: number }
  } | null
  goTo(target: string): Promise<unknown>
}

/** How much of the page's first words a bookmark keeps, for its row in the list. */
export const SNIPPET_CHARS = 200

const snippet = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS - 1).trimEnd()}…` : flat
}

const BLOCKS = /^(p|div|h[1-6]|li|blockquote|pre|section|article|td|th|dd|dt|figcaption|br)$/i

/**
 * A range's words with a space where one block ends and the next begins: `toString` runs a heading
 * and its paragraph, or two paragraphs, into one word.
 */
export function textOf(range: Range): string {
  const root = range.commonAncestorContainer
  const doc = root.ownerDocument ?? (root as Document)
  if (root.nodeType === 3) return range.toString()
  const walker = doc.createTreeWalker(root, 1 | 4)
  let out = ''
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue
    if (node.nodeType === 1) {
      if (BLOCKS.test((node as Element).localName)) out += ' '
      continue
    }
    const value = node.nodeValue ?? ''
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : value.length
    out += value.slice(start, end)
  }
  return out
}

export class PageBookmarks {
  private stopChange: () => void
  private stopped = false

  constructor(
    private readonly store: BookBookmarks,
    private readonly key: string,
    private readonly model: BookModel,
    private readonly engine: () => BookmarkEngine | null,
    /** A PDF's page as text, which its CFI has none of; null for a book. */
    private readonly pageText: ((index: number) => Promise<string>) | null = null
  ) {
    this.stopChange = store.onChange((keys) => {
      if (keys.includes(key)) void this.load()
    })
    void this.load()
  }

  private async load(): Promise<void> {
    const marks = await this.store.list(this.key)
    if (this.stopped) return
    this.model.bookmarks = marks
    this.relocated()
  }

  private here(): Bookmark[] {
    return onPage(this.model.bookmarks, this.engine()?.lastLocation?.cfi)
  }

  /** The page on screen changed: which bookmarks it has. */
  relocated(): void {
    const ids = this.here().map((m) => m.id)
    if (ids.join() !== this.model.bookmarksHere.join()) this.model.bookmarksHere = ids
  }

  /** Marks the page on screen, or unmarks it when it has a bookmark already. */
  async toggle(): Promise<void> {
    const here = this.here()
    if (here.length) {
      for (const mark of here) await this.store.remove(this.key, mark.id)
      return
    }
    const at = this.engine()?.lastLocation
    if (!at?.cfi) return
    let text = at.range ? textOf(at.range) : ''
    const index = at.index ?? at.section?.current
    if (!text && this.pageText && typeof index === 'number')
      text = await this.pageText(index).catch((): string => '')
    await this.store.add(this.key, {
      cfi: at.cfi,
      fraction: this.model.fraction,
      label: this.model.chapter,
      text: snippet(text),
    })
  }

  remove(mark: Bookmark): Promise<void> {
    return this.store.remove(this.key, mark.id)
  }

  async go(mark: Bookmark): Promise<void> {
    await this.engine()?.goTo(mark.cfi)
  }

  stop(): void {
    this.stopped = true
    this.stopChange()
  }
}

/** A tab's bookmarks for the book it opened; null before the plugin's store exists. */
export function bookmarksFor(
  key: string,
  model: BookModel,
  engine: unknown,
  pdf: unknown
): PageBookmarks | null {
  const store = bookBookmarks()
  const text = (pdf as Partial<PdfBookExtras> | null)?.pageText
  return store
    ? new PageBookmarks(store, key, model, () => engine as BookmarkEngine, text ?? null)
    : null
}
