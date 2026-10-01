import type { WordParagraph } from './package'
import type { WordEdit } from './edit'

/** One minimal replacement preserves untouched runs when a whole paragraph field is edited. */
export function paragraphTextEdit(p: WordParagraph, next: string): WordEdit {
  let from = 0
  while (from < p.text.length && from < next.length && p.text[from] === next[from]) from++
  let oldEnd = p.text.length
  let newEnd = next.length
  while (oldEnd > from && newEnd > from && p.text[oldEnd - 1] === next[newEnd - 1]) {
    oldEnd--
    newEnd--
  }
  // Keep surrogate pairs whole at both boundaries.
  if (from > 0 && /[\ud800-\udbff]/.test(p.text[from - 1])) from--
  if (oldEnd < p.text.length && /[\udc00-\udfff]/.test(p.text[oldEnd])) {
    oldEnd++
    newEnd++
  }
  const old = p.text.slice(from, oldEnd)
  if (!old)
    return {
      operation: 'insert',
      paragraph: p.number,
      offset: from,
      text: next.slice(from, newEnd),
    }
  return {
    operation: 'replace',
    paragraph: p.number,
    old_text: old,
    offset: from,
    new_text: next.slice(from, newEnd),
  }
}
