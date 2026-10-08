import type { SourceParagraph } from './source'

/** A projected end belongs to its last visible unit, never to an excluded trailing control. */
export function proseAnchor(paragraph: SourceParagraph, count: number): number {
  if (count < 0 || count > paragraph.positions.length) return paragraph.from
  return paragraph.positions[count] ?? paragraph.visibleTo ?? paragraph.from
}

export function proseBlocks(column: HTMLElement): HTMLElement[] {
  return Array.from(column.querySelectorAll<HTMLElement>('p,h1,h2,h3,h4,h5,h6,li')).filter((el) => {
    if (
      el.closest('.internal-embed') ||
      el.closest('.abele-column') !== column ||
      (el.tagName === 'LI' && Array.from(el.children).some((c) => c.matches('p')))
    )
      return false
    if (el.querySelector('img,.internal-embed,.math')) {
      const range = el.ownerDocument.createRange()
      range.selectNodeContents(el)
      return !!proseText(range).trim()
    }
    return true
  })
}

/** The native prose stream excludes controls and generated renderer text. No text search is used. */
export function proseText(range: Range, listItem = false): string {
  const fragment = range.cloneContents()
  for (const opaque of Array.from(
    fragment.querySelectorAll('a,.math,.footnote-ref,.internal-embed,img,svg,button,input,ul,ol')
  ))
    opaque.remove()
  const text = fragment.textContent ?? ''
  return listItem ? text.trimStart() : text
}
