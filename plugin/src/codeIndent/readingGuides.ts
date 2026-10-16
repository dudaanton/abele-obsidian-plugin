import { guideDepths, indentStep } from './indentGuides'
import './indentGuides.scss'

/**
 * Indent guides in a rendered code block (reading mode). Each line of `code` is put in a span of
 * its own, its highlighting kept, so a line that wraps carries its guides down with it; the
 * text is the same character for character, so copying and selecting are not changed.
 */
export function drawReadingGuides(code: HTMLElement, tabSize: number): void {
  // Drawn already; a block Obsidian renders again comes back without the line spans.
  if (code.firstElementChild?.classList.contains('abele-code-line')) return
  const text = code.textContent ?? ''
  const lines = text.replace(/\n$/, '').split('\n')
  const depths = guideDepths(lines, tabSize)
  if (!depths.some(Boolean)) return
  const rows = splitLines(code)
  const step = indentStep(lines, tabSize)
  code.style.setProperty('--abele-guide-step', `${step}ch`)
  code.replaceChildren(
    ...rows.map((row, i) => {
      row.className = 'abele-code-line'
      row.style.tabSize = String(tabSize)
      if (depths[i]) row.style.setProperty('--abele-guide-depth', String(depths[i]))
      return row
    })
  )
  if (text.endsWith('\n')) {
    // Chromium omits a terminal preformatted newline from selection unless there
    // is a following line break in layout. This adds no text or visible line height.
    const end = code.ownerDocument.win.createEl('br')
    end.className = 'abele-code-newline'
    rows.at(-1).append(end)
  }
}

/** The code's nodes cut at each newline into one span per line, ancestors cloned on both sides. */
function splitLines(code: HTMLElement): HTMLElement[] {
  const doc = code.ownerDocument
  const rows: HTMLElement[] = [doc.win.createSpan()]
  const walk = (node: Node, into: () => Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parts = (node.textContent ?? '').split('\n')
      parts.forEach((part, i) => {
        if (i > 0) {
          rows.at(-1).append('\n')
          rows.push(doc.win.createSpan())
        }
        if (part) into().appendChild(doc.createTextNode(part))
      })
      return
    }
    const el = node as Element
    // The clone of this element in the line now being filled, made again after each newline.
    let made: { row: HTMLElement; el: Node } | null = null
    const mine = () => {
      if (made?.row !== rows.at(-1))
        made = { row: rows.at(-1), el: into().appendChild(el.cloneNode(false)) }
      return made.el
    }
    el.childNodes.forEach((child) => walk(child, mine))
  }
  code.childNodes.forEach((child) => walk(child, () => rows.at(-1)))
  // The text's last newline ends the last line rather than opening an empty one.
  if (rows.length > 1 && !rows.at(-1).textContent) rows.pop()
  return rows
}
