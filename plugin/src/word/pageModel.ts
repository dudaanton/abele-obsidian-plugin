import type { WordEdit } from './edit'

/**
 * What the page shows of a Word document: its paragraphs in order, each with its style, list and
 * the marks on its runs, the tables and pictures where they stand. Read from the package; the page
 * changes nothing itself and hands every change back as a `WordEdit`, one paragraph at a time.
 */
export type WordMark = 'bold' | 'italic' | 'underline' | 'strike'

export interface WordPageRun {
  text: string
  marks?: WordMark[]
  link?: string
}

export interface WordPageParagraph {
  kind: 'paragraph'
  number: number
  runs: WordPageRun[]
  /** The style's id, as the document names it: `Heading1`, `Quote`. */
  style?: string
  list?: 'bullet' | 'decimal'
  /** Kept as Word wrote it: a field, a complex layout. Shown, never edited here. */
  locked?: boolean
}

export interface WordPageImage {
  kind: 'image'
  number: number
  paragraph: number
  src: string
  alt: string
  width: number
  height: number
}

export interface WordPageTable {
  kind: 'table'
  number: number
  rows: WordPageParagraph[][]
}

export type WordPageBlock = WordPageParagraph | WordPageImage | WordPageTable

export interface WordPageStyle {
  id: string
  name: string
}

export interface WordPageModel {
  blocks: WordPageBlock[]
  styles: WordPageStyle[]
  /** Why it cannot be changed here, when it cannot. */
  readOnly?: string
}

export type WordSaveState =
  | { state: 'idle' | 'saving' | 'saved' }
  | { state: 'failed'; reason: string }

export type WordPageEdit = WordEdit

export const paragraphText = (p: WordPageParagraph) => p.runs.map((r) => r.text).join('')

/** Every paragraph the page holds, those inside tables included, in reading order. */
export const allParagraphs = (model: WordPageModel): WordPageParagraph[] =>
  model.blocks.flatMap((block) =>
    block.kind === 'paragraph' ? [block] : block.kind === 'table' ? block.rows.flat() : []
  )

export const wordCount = (model: WordPageModel) =>
  allParagraphs(model).reduce(
    (sum, p) => sum + (paragraphText(p).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0),
    0
  )

/** A mark is on when every character of the range carries it. */
export function markCovers(
  p: WordPageParagraph,
  mark: WordMark,
  from: number,
  to: number
): boolean {
  if (to <= from) return false
  let at = 0
  for (const run of p.runs) {
    const end = at + run.text.length
    if (end > from && at < to && !run.marks?.includes(mark)) return false
    at = end
  }
  return true
}
