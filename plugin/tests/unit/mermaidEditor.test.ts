/**
 * The mermaid viewer in Live Preview: which blocks it draws over, and when it hands a block
 * back as source.
 */
import { describe, it, expect } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { editorInfoField, editorLivePreviewField } from 'obsidian'
import { MermaidWidget, mermaidEditorExtension, refreshMermaid } from '@/editor/MermaidPlugin'

const DOC = [
  'Intro', // 1
  '```mermaid', // 2
  'graph TD', // 3
  'A-->B', // 4
  '```', // 5
  'Outro', // 6
].join('\n')

let active = true

const state = (anchor = 0, livePreview = true) =>
  EditorState.create({
    doc: DOC,
    selection: EditorSelection.single(anchor),
    extensions: [
      editorLivePreviewField.init(() => livePreview),
      editorInfoField,
      mermaidEditorExtension(() => active),
    ],
  })

/** The widgets the editor would draw, with the range each replaces. */
const widgets = (s: EditorState) => {
  const found: { from: number; to: number; source: string }[] = []
  for (const source of s.facet(EditorView.decorations)) {
    const set = typeof source === 'function' ? null : source
    set?.between(0, s.doc.length, (from, to, deco) => {
      const widget = deco.spec.widget
      if (widget instanceof MermaidWidget) found.push({ from, to, source: widget.source })
    })
  }
  return found
}

describe('the mermaid field', () => {
  it('draws the whole fenced block as one diagram', () => {
    active = true
    const s = state(0)
    expect(widgets(s)).toEqual([
      { from: s.doc.line(2).from, to: s.doc.line(5).to, source: 'graph TD\nA-->B' },
    ])
  })

  it('shows the block as source while the cursor is in it, and draws it again after', () => {
    active = true
    const s = state(0)
    const inside = s.update({ selection: { anchor: s.doc.line(3).from + 2 } }).state
    expect(widgets(inside)).toEqual([])
    const after = inside.update({ selection: { anchor: inside.doc.line(6).from } }).state
    expect(widgets(after)).toHaveLength(1)
  })

  it('follows an edit to the source', () => {
    active = true
    const s = state(0)
    const at = s.doc.line(4).to
    const edited = s.update({ changes: { from: at, insert: '\nB-->C' } }).state
    expect(widgets(edited)[0].source).toBe('graph TD\nA-->B\nB-->C')
  })

  it('draws nothing in source mode', () => {
    active = true
    expect(widgets(state(0, false))).toEqual([])
  })

  it('draws nothing while off, and picks the change up when told to look again', () => {
    active = false
    const s = state(0)
    expect(widgets(s)).toEqual([])
    active = true
    expect(widgets(s.update({ effects: refreshMermaid.of(null) }).state)).toHaveLength(1)
  })
})
