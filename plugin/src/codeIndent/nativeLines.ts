import type { EditorView } from '@codemirror/view'

export type CodeLineKind = 'code' | 'fence' | null
export interface CodeMetrics {
  cell: number
  inset: number
}

/** Read only mounted lines, after HyperMD has applied its native line attributes. */
export function nativeCodeLines(
  view: EditorView,
  tabSize: number,
  parsed: (number: number) => CodeLineKind
) {
  const kinds = new Map<number, CodeLineKind>()
  const metrics = new Map<number, CodeMetrics>()
  const blocks: { start: number; end: number }[] = []
  for (const element of Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.cm-line'))) {
    const fence = element.matches('.HyperMD-codeblock-begin, .HyperMD-codeblock-end')
    if (
      !fence &&
      !element.matches('.HyperMD-codeblock, .HyperMD-codeblock-bg') &&
      !element.querySelector('.cm-hmd-codeblock')
    )
      continue
    const number = view.state.doc.lineAt(view.posAtDOM(element)).number
    kinds.set(number, fence ? 'fence' : 'code')
    if (fence) continue
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const first = walker.nextNode() as Text | null
    if (!first || !/^[\t ]/.test(first.data)) continue
    const range = element.ownerDocument.createRange()
    range.setStart(first, 0)
    const indent = /^[\t ]+/.exec(first.data)[0]
    let columns = 0
    for (const char of indent) columns += char === '\t' ? tabSize - (columns % tabSize) : 1
    range.setEnd(first, indent.length)
    const rect = range.getBoundingClientRect()
    const cell = rect.width / columns
    const style = element.ownerDocument.defaultView.getComputedStyle(element)
    // Range coordinates may be rounded by WebKit. Keep the native layout inset
    // in CSS pixels, undoing our hanging indent when measuring decorated lines.
    const padding = parseFloat(style.paddingInlineStart)
    const inset = Number.isFinite(padding)
      ? padding + (parseFloat(style.textIndent) || 0)
      : rect.left - element.getBoundingClientRect().left
    if (cell > 0) metrics.set(number, { cell, inset })
  }
  // A visible native code line confirms membership. Locate only that block's source
  // boundaries when its opening/closing lines are outside the mounted viewport.
  for (const [number, type] of Array.from(kinds)) {
    if (type !== 'code' || blocks.some((b) => number >= b.start && number <= b.end)) continue
    let opening = number - 1
    let marker: RegExpExecArray | null = null
    for (; opening > 0; opening--) {
      if (kinds.get(opening) === 'code' || (!kinds.has(opening) && parsed(opening) === 'code'))
        continue
      marker = /^[\t ]*(`{3,}|~{3,})([^`~]*)$/.exec(view.state.doc.line(opening).text)
      if (marker) break
    }
    if (!marker || opening < 1) continue
    const close = new RegExp(`^[\\t ]*${marker[1][0]}{${marker[1].length},}[\\t ]*$`)
    let end = opening + 1
    while (end <= view.state.doc.lines && !close.test(view.state.doc.line(end).text)) end++
    if (number >= end) continue
    kinds.set(opening, 'fence')
    if (end <= view.state.doc.lines) kinds.set(end, 'fence')
    blocks.push({ start: opening + 1, end: end - 1 })
  }
  return { kinds, metrics, blocks }
}
