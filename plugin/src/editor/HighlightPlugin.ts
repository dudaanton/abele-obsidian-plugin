import { StateField, RangeSetBuilder, EditorState } from '@codemirror/state'
import { Decoration, DecorationSet, EditorView } from '@codemirror/view'
import { editorLivePreviewField } from 'obsidian'

/**
 * Matches =={color} text== where color is a word (e.g. red, blue, green).
 * Captures: [1] = opening ==, [2] = {color} , [3] = text, [4] = closing ==
 */
const HIGHLIGHT_RE = /=={(\w+)}\s((?:(?!==).)+)==/g

export const HIGHLIGHT_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
  'pink',
  'gray',
] as const

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

interface HighlightMatch {
  from: number
  to: number
  color: string
  /** Position of the opening == */
  openFrom: number
  /** Position after {color}  (space included) */
  openTo: number
  /** Position of the closing == */
  closeFrom: number
  closeTo: number
}

function findHighlights(state: EditorState): HighlightMatch[] {
  const matches: HighlightMatch[] = []

  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i)
    HIGHLIGHT_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = HIGHLIGHT_RE.exec(line.text)) !== null) {
      const fullFrom = line.from + match.index
      const fullTo = fullFrom + match[0].length
      const color = match[1]
      // ==        {color} text     ==
      // ^openFrom ^openTo  ^closeFrom ^closeTo
      const openFrom = fullFrom
      const openTo = fullFrom + 2 + 1 + color.length + 1 + 1 // =={ + color + } + space
      const closeFrom = fullTo - 2
      const closeTo = fullTo

      matches.push({ from: fullFrom, to: fullTo, color, openFrom, openTo, closeFrom, closeTo })
    }
  }

  return matches
}

function buildHighlightDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()

  if (!state.field(editorLivePreviewField)) {
    return builder.finish()
  }

  const highlights = findHighlights(state)

  const marks: { from: number; to: number; decoration: Decoration }[] = []

  for (const h of highlights) {
    const cursorInside = state.selection.ranges.some((r) => r.from >= h.from && r.to <= h.to)

    if (cursorInside) {
      // Cursor inside: show syntax but style the whole thing
      marks.push({
        from: h.openFrom,
        to: h.openTo,
        decoration: Decoration.mark({ class: 'abele-highlight-syntax' }),
      })
      marks.push({
        from: h.openTo,
        to: h.closeFrom,
        decoration: Decoration.mark({ class: `abele-highlight abele-highlight--${h.color}` }),
      })
      marks.push({
        from: h.closeFrom,
        to: h.closeTo,
        decoration: Decoration.mark({ class: 'abele-highlight-syntax' }),
      })
    } else {
      // No cursor: hide syntax, show only highlighted text
      marks.push({
        from: h.openFrom,
        to: h.openTo,
        decoration: Decoration.mark({ class: 'abele-highlight-syntax-hidden' }),
      })
      marks.push({
        from: h.openTo,
        to: h.closeFrom,
        decoration: Decoration.mark({ class: `abele-highlight abele-highlight--${h.color}` }),
      })
      marks.push({
        from: h.closeFrom,
        to: h.closeTo,
        decoration: Decoration.mark({ class: 'abele-highlight-syntax-hidden' }),
      })
    }
  }

  marks.sort((a, b) => a.from - b.from || a.to - b.to)

  for (const m of marks) {
    builder.add(m.from, m.to, m.decoration)
  }

  return builder.finish()
}

export const highlightStateField = StateField.define<DecorationSet>({
  create(state) {
    return buildHighlightDecorations(state)
  },
  update(decorations, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.state.field(editorLivePreviewField) !== tr.startState.field(editorLivePreviewField)
    ) {
      return buildHighlightDecorations(tr.state)
    }
    return decorations.map(tr.changes)
  },
  provide(field) {
    return [EditorView.decorations.from(field)]
  },
})

/**
 * Find if the cursor is currently inside a colored highlight.
 * Returns the match info or null.
 */
export function getHighlightAtCursor(editor: {
  getValue: () => string
  getCursor: () => { line: number; ch: number }
  posToOffset: (pos: { line: number; ch: number }) => number
}): { color: string; from: number; to: number; openTo: number; closeFrom: number } | null {
  const content = editor.getValue()
  const offset = editor.posToOffset(editor.getCursor())

  HIGHLIGHT_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = HIGHLIGHT_RE.exec(content)) !== null) {
    const from = match.index
    const to = from + match[0].length
    if (offset >= from && offset <= to) {
      const color = match[1]
      const openTo = from + 2 + 1 + color.length + 1 + 1
      const closeFrom = to - 2
      return { color, from, to, openTo, closeFrom }
    }
  }

  return null
}
