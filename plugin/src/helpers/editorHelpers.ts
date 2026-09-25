import type { EditorState } from '@codemirror/state'
import { editorEditorField, editorInfoField, type Editor, type EditorPosition } from 'obsidian'

export function rangesOverlap(start1: number, end1: number, start2: number, end2: number): boolean {
  return start1 <= end2 && start2 <= end1
}

/**
 * True for an editor Obsidian opens *inside* a note — the one a table cell gets when it is
 * clicked in live preview — rather than the note's own.
 *
 * Such an editor is handed the note's `editorInfoField` whole, file and all, so anything that
 * decorates "the note" from that field decorates the cell too: the footer used to appear
 * inside the table. What differs is `editorEditorField`, the editor the state belongs to,
 * which for a cell is not the note's editor. Either side can be missing while the note's
 * editor is still being built; that reads as the note, since the note is what is common.
 */
export function isNestedEditor(state: EditorState): boolean {
  const own = state.field(editorEditorField, false)
  const info = state.field(editorInfoField, false) as { editor?: { cm?: unknown } } | undefined
  const noteEditor = info?.editor?.cm
  return !!own && !!noteEditor && own !== noteEditor
}

/**
 * Writes `text` at the cursor on a line of its own, so a paragraph is never cut in two: after the
 * cursor's line when that line has text — with a blank line between when `blankLine` — and in
 * place of the line when it is empty.
 *
 * @returns where the text ends
 */
export function insertOnOwnLine(editor: Editor, text: string, blankLine = false): EditorPosition {
  const cursor = editor.getCursor()
  const line = editor.getLine(cursor.line)
  let startLine = cursor.line
  if (line.trim()) {
    const gap = blankLine ? '\n\n' : '\n'
    editor.replaceRange(`${gap}${text}`, { line: cursor.line, ch: line.length })
    startLine += gap.length
  } else {
    editor.replaceRange(text, { line: cursor.line, ch: 0 })
  }
  const written = text.split('\n')
  const last = written[written.length - 1]
  return { line: startLine + written.length - 1, ch: last.length }
}

/**
 * Writes a block — a fenced card — at the cursor on lines of its own, with a blank line before
 * it when it follows text and a blank line after it unless the note already has one there.
 * Adding one regardless left two blank lines under the card, which live preview draws as an
 * empty line hanging below it.
 *
 * @returns where the block ends
 */
export function insertBlockOnOwnLine(editor: Editor, block: string): EditorPosition {
  const nextLine = editor.getCursor().line + 1
  const next = nextLine < editor.lineCount() ? editor.getLine(nextLine) : ''
  const after = next.trim() === '' ? '' : '\n'
  return insertOnOwnLine(editor, `${block}${after}`, true)
}
