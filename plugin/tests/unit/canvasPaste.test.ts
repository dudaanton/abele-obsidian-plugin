/** What a paste puts on the canvas (`canvas/paste.ts`), applied as one change. */
import { describe, expect, it } from 'vitest'
import { pasteOps } from '@/canvas/paste'
import { editCanvas } from '@/canvas/core/edit'
import { emptyCanvas, type CanvasGraph } from '@/canvas/core/model'

const apply = (ops: ReturnType<typeof pasteOps>['ops'], graph: CanvasGraph = emptyCanvas()) =>
  editCanvas(graph, ops).graph

describe('a paste on the canvas', () => {
  it('stands a pasted picture as a card in its proportions, its middle where it was pasted', () => {
    const { ops, ids } = pasteOps(
      { kind: 'files', files: [{ path: 'Pasted image sample.png', width: 1600, height: 800 }] },
      { x: 500, y: 300 }
    )
    const node = apply(ops).nodes.find((n) => n.id === ids[0])!
    expect(node).toMatchObject({ type: 'file', file: 'Pasted image sample.png', width: 400, height: 200 })
    expect(node.x + node.width / 2).toBe(500)
    expect(node.y + node.height / 2).toBe(300)
  })
  it('stands several files in a row', () => {
    const { ops } = pasteOps(
      { kind: 'files', files: [{ path: 'a.png', width: 100, height: 100 }, { path: 'b.pdf' }] },
      { x: 0, y: 0 }
    )
    const [a, b] = apply(ops).nodes
    expect(b.x).toBe(a.x + a.width + 40)
  })
  it('makes an address a web page card and other words a text card', () => {
    const page = apply(pasteOps({ kind: 'text', text: ' https://sample.example/page ' }, { x: 0, y: 0 }).ops)
    expect(page.nodes[0]).toMatchObject({ type: 'link', url: 'https://sample.example/page' })
    const words = apply(pasteOps({ kind: 'text', text: 'A sample thought' }, { x: 0, y: 0 }).ops)
    expect(words.nodes[0]).toMatchObject({ type: 'text', text: 'A sample thought' })
  })
  it('brings back cards copied from a canvas as copies, joined and framed the same way', () => {
    const copied = {
      nodes: [
        { id: 'f', type: 'group', label: 'Sample', x: 0, y: 0, width: 600, height: 300 },
        { id: 'a', type: 'text', text: 'one', x: 20, y: 40, width: 200, height: 100 },
        { id: 'b', type: 'text', text: 'two', x: 300, y: 40, width: 200, height: 100, styleAttributes: { shape: 'diamond' } },
      ],
      edges: [{ id: 'e', fromNode: 'a', toNode: 'b', label: 'then' }],
    }
    const graph: CanvasGraph = { nodes: [{ ...copied.nodes[1], id: 'a' } as never], edges: [] }
    const { ops, ids } = pasteOps({ kind: 'text', text: JSON.stringify(copied) }, { x: 1000, y: 1000 })
    const next = apply(ops, graph)
    expect(ids).toHaveLength(3)
    expect(next.nodes).toHaveLength(4)
    const two = next.nodes.find((n) => n.text === 'two' && n.id !== 'b')!
    expect(two.styleAttributes?.shape).toBe('diamond')
    expect(next.edges).toHaveLength(1)
    expect(next.edges[0]).toMatchObject({ label: 'then', toNode: two.id })
    const frame = next.nodes.find((n) => n.type === 'group')!
    expect(frame.x + frame.width / 2).toBe(1000)
  })
})
