import { expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { mountCode } from '@/github/codeViewer'
it('marks the exact search word and clears it when ordinary line navigation resumes', () => {
  const parent = document.createElement('div')
  document.body.append(parent)
  const viewer = mountCode(parent, 'const sample = true', 'sample.ts', {
    start: 1,
    end: 1,
    match: { column: 6, length: 6 },
  })
  expect(parent.querySelector('.cm-searchMatch')?.textContent).toBe('sample')
  viewer.mark({ start: 1, end: 1 })
  expect(parent.querySelector('.cm-searchMatch')).toBeNull()
  viewer.destroy()
  parent.remove()
})
it('keeps ordinary file views read only and uses the same code renderer for editing without redraw', () => {
  const parent = document.createElement('div')
  document.body.append(parent)
  const viewer = mountCode(parent, 'before', 'sample.ts')
  expect(
    EditorView.findFromDOM(parent.querySelector('.cm-editor')!)!.state.facet(EditorState.readOnly)
  ).toBe(true)
  viewer.destroy()
  const change = vi.fn()
  const editable = mountCode(parent, 'before', 'sample.ts', undefined, {}, undefined, change)
  const view = EditorView.findFromDOM(parent.querySelector('.cm-editor')!)!
  expect(view.state.facet(EditorState.readOnly)).toBe(false)
  view.dispatch({ changes: { from: 0, to: 6, insert: 'draft' } })
  expect(change).toHaveBeenCalledWith('draft')
  editable.setText('draft')
  expect(change).toHaveBeenCalledTimes(1)
  editable.setText('different restored draft')
  expect(change).toHaveBeenCalledTimes(1)
  expect(EditorView.findFromDOM(parent.querySelector('.cm-editor')!)).toBe(view)
  editable.destroy()
  parent.remove()
})
