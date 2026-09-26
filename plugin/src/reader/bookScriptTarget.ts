/**
 * What a script run on words in a book is told about them (`book` in its scope): the words, a
 * link to their place, the book, the chapter, and the whole sentence they are in — read off the
 * page, by the same sentence rules reading aloud uses.
 */
import type { TFile } from 'obsidian'
import type { BookScriptContext } from '@/scripting/bookContext'
import { sentencesIn } from './sentences'

/** The sentence, or the sentences, the words of `range` are in; the words when there is none. */
export function sentenceOf(range: Range, lang = ''): string {
  const words = range.toString().replace(/\s+/g, ' ').trim()
  const doc = range.startContainer.ownerDocument
  if (!doc) return words
  const found: string[] = []
  try {
    for (const s of sentencesIn(doc, lang || doc.documentElement?.lang || 'en', range)) {
      found.push(s.text)
      // Enough once a sentence reaches the end of the words.
      if (s.range.compareBoundaryPoints(Range.END_TO_END, range) >= 0) break
      if (found.length >= 12) break
    }
  } catch (e) {
    console.debug('[Abele] no sentence around the words', e)
  }
  return found.join(' ') || words
}

interface Resolver {
  resolveNavigation(cfi: string): { index?: number; anchor?: (d: Document) => unknown } | null
  renderer: { getContents(): { doc?: Document; index?: number }[] }
}

/** The words at `cfi` on a page on screen, as a range; null when they are not showing. */
export function rangeOnScreen(engine: Resolver, cfi: string): Range | null {
  let resolved: ReturnType<Resolver['resolveNavigation']>
  try {
    resolved = engine.resolveNavigation(cfi)
  } catch {
    return null
  }
  for (const { doc, index } of engine.renderer.getContents()) {
    if (!doc || (resolved?.index !== undefined && index !== resolved.index)) continue
    const anchor = resolved?.anchor?.(doc)
    if (!anchor || !doc.defaultView) continue
    if (anchor instanceof doc.defaultView.Range) return anchor
    if (anchor instanceof doc.defaultView.Node) {
      const range = doc.createRange()
      range.selectNodeContents(anchor)
      return range
    }
  }
  return null
}

export function bookScriptContext(args: {
  file: TFile
  title: string
  target: { cfi: string; label: string; text: string }
  link: string
  range: Range | null
  lang?: string
}): BookScriptContext {
  const { file, target } = args
  return {
    text: target.text,
    link: args.link,
    path: file.path,
    title: args.title || file.basename,
    chapter: target.label,
    sentence: args.range ? sentenceOf(args.range, args.lang) : target.text,
    cfi: target.cfi,
  }
}
