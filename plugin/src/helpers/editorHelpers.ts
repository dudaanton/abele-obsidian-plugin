import type { EditorState } from '@codemirror/state'
import { editorEditorField, editorInfoField } from 'obsidian'

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
