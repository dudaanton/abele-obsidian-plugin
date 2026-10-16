import { expect, it } from 'vitest'
import { setup } from '../helpers/canvasEditorHarness'

it('keeps the canvas panel default in the document with undo and reload', () => {
  const s = setup({ nodes: [], edges: [], abele: { sample: 'kept' } })
  expect(s.editor.controls.notePanels()).toBe(false)
  s.editor.controls.setNotePanels(true)
  expect(s.document.session.graph.abele).toEqual({ sample: 'kept', notePanels: true })
  const reopened = setup(JSON.parse(JSON.stringify(s.document.session.graph)))
  expect(reopened.editor.controls.notePanels()).toBe(true)
  s.document.undoLocal()
  expect(s.editor.controls.notePanels()).toBe(false)
})

it('keeps a card opt-out and unrelated extension fields through serialization', async () => {
  const s = setup({
    nodes: [
      {
        id: 'sample',
        type: 'file',
        file: 'sample.md',
        x: 0,
        y: 0,
        width: 340,
        height: 500,
        abele: { pinned: true },
      },
    ],
    edges: [],
    abele: { notePanels: true },
  })
  await s.editor.controls.setPanels('sample', false)
  const graph = JSON.parse(JSON.stringify(s.document.session.graph))
  expect(graph.nodes[0].abele).toEqual({ pinned: true, panels: false })
  const reopened = setup(graph)
  expect(reopened.editor.controls.notePanels()).toBe(true)
  expect(reopened.document.session.graph.nodes[0].abele.panels).toBe(false)
})
