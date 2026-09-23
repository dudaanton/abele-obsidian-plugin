/**
 * The footer belongs to the note, once, under its last line.
 *
 * Clicking a table cell in live preview opens a small editor inside the cell, and Obsidian
 * gives it the note's own file info — so every extension that asked "which note is this?" put
 * the note's footer into the cell as well: backlinks, tasks and all, inside a table. The one
 * thing that tells the two editors apart is the editor each state belongs to: the cell's is
 * not the note's.
 */
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { TFile, editorEditorField, editorInfoField, editorLivePreviewField } from 'obsidian'
import { taskStateField } from '@/editor/TaskPlugin'
import { FooterWidget } from '@/editor/FooterWidget'
import { isNestedEditor } from '@/helpers/editorHelpers'

function noteFile(): TFile {
  const file = new TFile()
  file.path = 'Notes/Table.md'
  file.basename = 'Table'
  file.extension = 'md'
  return file
}

const noteEditor = { name: 'the note' }
const cellEditor = { name: 'a table cell' }

function stateOf(doc: string, own: unknown, noteCm: unknown = noteEditor): EditorState {
  const file = noteFile()
  return EditorState.create({
    doc,
    extensions: [
      editorLivePreviewField.init(() => true),
      editorInfoField.init(() => ({ file, editor: { cm: noteCm } })),
      editorEditorField.init(() => own),
      taskStateField,
    ],
  })
}

function footers(state: EditorState): number {
  let count = 0
  state.field(taskStateField).between(0, state.doc.length, (_from, _to, deco) => {
    if (deco.spec.widget instanceof FooterWidget) count++
  })
  return count
}

describe('the note footer', () => {
  it('sits under the note in its own editor', () => {
    expect(footers(stateOf('| a | b |\n| - | - |\n| 1 | 2 |', noteEditor))).toBe(1)
  })

  it('is not put into the editor a table cell opens', () => {
    expect(footers(stateOf('1', cellEditor))).toBe(0)
  })

  it('is still there while the note editor is being made and does not know itself yet', () => {
    // Obsidian builds the first state before the editor it belongs to exists.
    expect(footers(stateOf('Text', null, undefined))).toBe(1)
    expect(footers(stateOf('Text', undefined, undefined))).toBe(1)
  })
})

describe('isNestedEditor', () => {
  it('knows a cell editor from the note editor, and assumes the note when unsure', () => {
    expect(isNestedEditor(stateOf('x', cellEditor))).toBe(true)
    expect(isNestedEditor(stateOf('x', noteEditor))).toBe(false)
    expect(isNestedEditor(stateOf('x', null, undefined))).toBe(false)
  })
})
