import { describe, expect, it } from 'vitest'
import { editCanvas } from '@/canvas/core/edit'
import { emptyCanvas, parseCanvas, parentsOf, serializeCanvas } from '@/canvas/core/model'
import { layoutCanvas } from '@/canvas/core/layout'
import { canvasOutline } from '@/canvas/core/read'

function grouped() {
  return layoutCanvas(
    editCanvas(emptyCanvas(), [
      { op: 'add_node', node: { id: 'sample-card', kind: 'text', label: 'Sample card' } },
      { op: 'group', id: 'sample-group', ids: ['sample-card'] },
    ]).graph
  )
}
describe('native edits after an agent layout', () => {
  it('does not move a card back into a group it was moved out of natively', () => {
    const graph = grouped(),
      card = graph.nodes.find((n) => n.id === 'sample-card')!
    card.x = 3000
    card.y = 3000
    const read = parseCanvas(serializeCanvas(graph))
    expect(parentsOf(read).get(card.id)).toBeUndefined()
    expect(canvasOutline(read).nodes.find((n) => n.id === card.id)?.parent).toBeNull()
    expect(parentsOf(layoutCanvas(read, {})).get(card.id)).toBeUndefined()
  })
  it('keeps cards readable/editable when a native user deletes just the group frame', () => {
    const graph = grouped()
    graph.nodes = graph.nodes.filter((n) => n.id !== 'sample-group')
    const read = parseCanvas(JSON.stringify(graph))
    expect(parentsOf(read).get('sample-card')).toBeUndefined()
    expect(canvasOutline(read).nodes).toHaveLength(1)
    expect(
      editCanvas(read, [{ op: 'update', id: 'sample-card', patch: { text: 'Updated sample' } }])
        .graph.nodes[0].text
    ).toBe('Updated sample')
  })
  it('adopts a native group moved around a previously explicit root card', () => {
    const graph = grouped()
    const root = editCanvas(graph, [
      { op: 'add_node', node: { id: 'root-card', kind: 'text', label: 'Root', x: 2000, y: 0 } },
    ]).graph
    const frame = root.nodes.find((n) => n.id === 'sample-group')!,
      card = root.nodes.find((n) => n.id === 'root-card')!
    Object.assign(frame, {
      x: card.x - 40,
      y: card.y - 40,
      width: card.width + 80,
      height: card.height + 80,
    })
    expect(parentsOf(root).get('root-card')).toBe('sample-group')
  })
})
