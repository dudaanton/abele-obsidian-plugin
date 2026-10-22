import { expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { getChunks } from '@codemirror/merge'
import { mountCode } from '@/github/codeViewer'

it.each([false, true])('edits the working comparison live, split=%s', (split) => {
  const parent = document.createElement('div')
  document.body.append(parent)
  const change = vi.fn()
  const viewer = mountCode(parent, 'after', 'sample.ts', undefined, {}, undefined, change, true, {
    original: 'before',
    split,
  })
  try {
    const editors = [...parent.querySelectorAll<HTMLElement>('.cm-editor')]
    expect(editors).toHaveLength(split ? 2 : 1)
    const working = EditorView.findFromDOM(editors.at(-1)!)!
    expect(getChunks(working.state)?.chunks).toHaveLength(1)
    if (!split) {
      expect(parent.querySelector('.cm-deletedChunk')?.textContent).toContain('before')
      expect(parent.querySelector<HTMLElement>('.cm-deletedChunk')?.contentEditable).toBe('false')
      expect(parent.querySelector('.abele-code-change')).toBeNull()
      expect(working.state.doc.toString()).toBe('after')
      working.dispatch({ selection: { anchor: 0 } })
      expect(working.state.doc.sliceString(0, 1)).toBe('a')
    }
    if (split) {
      expect(editors[0].querySelector('.cm-lineNumbers')).not.toBeNull()
      const original = EditorView.findFromDOM(editors[0])!
      expect(original.state.facet(EditorState.readOnly)).toBe(true)
      expect(original.contentDOM.contentEditable).toBe('false')
    }
    working.dispatch({ changes: { from: 0, to: 5, insert: 'before' } })
    expect(change).toHaveBeenLastCalledWith('before')
    expect(getChunks(working.state)?.chunks).toHaveLength(0)
    if (!split) expect(parent.querySelector('.cm-deletedChunk')).toBeNull()
    viewer.setText('saved')
    expect(change).toHaveBeenCalledTimes(1)
    expect(working.state.doc.toString()).toBe('saved')
  } finally {
    viewer.destroy()
    parent.remove()
  }
})
