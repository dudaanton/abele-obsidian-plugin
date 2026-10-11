import { EditorView } from '@codemirror/view'

export interface FileSelection {
  text: string
  from: number
  to: number
  side: 'before' | 'after' | 'diff'
}

/** Native selection in code or comparison text, never in its header, numbers or controls. */
export function fileSelection(
  root: HTMLElement,
  selection: Selection | null
): FileSelection | null {
  if (!selection?.rangeCount || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const element = (node: Node) => (node.nodeType === 1 ? (node as Element) : node.parentElement)
  const start = element(range.startContainer)
  const end = element(range.endContainer)
  if (
    start?.closest('.cm-content') &&
    end?.closest('.cm-content') === start.closest('.cm-content')
  ) {
    const editor = EditorView.findFromDOM(start as HTMLElement)!
    const from = editor.posAtDOM(range.startContainer, range.startOffset)
    const to = editor.posAtDOM(range.endContainer, range.endOffset)
    const text = editor.state.sliceDoc(from, to)
    return text.trim()
      ? {
          text,
          from: editor.state.doc.lineAt(from).number,
          to: editor.state.doc.lineAt(Math.max(from, to - 1)).number,
          side: 'after',
        }
      : null
  }
  if (!start?.closest('.abele-diff__text') || !end?.closest('.abele-diff__text')) return null
  const parts: { text: string; line: number; side: 'before' | 'after' }[] = []
  for (const text of Array.from(root.querySelectorAll('.abele-diff__text'))) {
    if (!range.intersectsNode(text)) continue
    const picked = root.ownerDocument.createRange()
    picked.selectNodeContents(text)
    if (text.contains(range.startContainer))
      picked.setStart(range.startContainer, range.startOffset)
    if (text.contains(range.endContainer)) picked.setEnd(range.endContainer, range.endOffset)
    const row = text.closest<HTMLElement>('.abele-diff__line')!
    const side =
      row.classList.contains('abele-diff__line_removed') ||
      row.classList.contains('abele-diff__line_left')
        ? 'before'
        : 'after'
    const line = Number(side === 'before' ? row.dataset.lineA : row.dataset.lineB)
    if (picked.toString() && line) parts.push({ text: picked.toString(), line, side })
  }
  if (!parts.length) return null
  const text = parts.map((p) => p.text).join('\n')
  return text.trim()
    ? {
        text,
        from: parts[0].line,
        to: parts[parts.length - 1].line,
        side: parts.every((p) => p.side === parts[0].side) ? parts[0].side : 'diff',
      }
    : null
}

export function selectionQuote(path: string, selection: FileSelection): string {
  const lines =
    selection.from === selection.to ? `${selection.from}` : `${selection.from}-${selection.to}`
  const side = selection.side === 'after' ? '' : ` (${selection.side})`
  return `${path}:${lines}${side}\n\n${selection.text}`
}
