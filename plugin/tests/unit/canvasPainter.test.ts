import { describe, expect, it } from 'vitest'
import { paintCanvas, pictureRegion, textResolutionWarnings } from '@/canvas/core/painter'
import { editCanvas } from '@/canvas/core/edit'
import { emptyCanvas, SHAPES } from '@/canvas/core/model'
import { contentBox, textLines, defaultMetrics, fitText } from '@/canvas/core/scene'
import { lintCanvas } from '@/canvas/core/lint'
import { planCanvasLayout } from '@/canvas/core/service'
import { serializeCanvas } from '@/canvas/core/model'

const theme = {
  paper: 'sample-paper',
  card: 'sample-card',
  text: 'sample-text',
  border: 'sample-border',
  accent: 'sample-accent',
  muted: 'sample-muted',
  font: 'sample-font',
  size: 16,
  lineHeight: 1.4,
  presets: ['sample-red'],
}
function context() {
  const calls: { name: string; args: unknown[] }[] = []
  const target: Record<string, unknown> = {}
  const ctx = new Proxy(target, {
    get(obj, key: string) {
      if (key in obj) return obj[key]
      return (...args: unknown[]) => {
        calls.push({ name: key, args })
        if (key === 'measureText') return { width: String(args[0]).length * 8 }
      }
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls, target }
}
describe('the shared canvas picture plan', () => {
  it.each(SHAPES)('paints %s with theme styles and clipped, wrapped labels', (shape) => {
    const graph = editCanvas(emptyCanvas(), [
      {
        op: 'add_node',
        node: {
          id: 'sample',
          kind: 'shape',
          shape,
          label: '# Sample\n- **Bold** [link](https://example.invalid)',
        },
      },
    ]).graph
    const { ctx, calls } = context()
    const result = paintCanvas(ctx, graph, { x: 0, y: 0, width: 500, height: 500 }, theme)
    expect(result.visible).toEqual(['sample'])
    expect(calls.some((c) => c.name === 'clip')).toBe(true)
    expect(
      calls
        .filter((c) => c.name === 'fillText')
        .map((c) => c.args[0])
        .join(' ')
    ).toContain('Sample')
    expect(
      calls
        .filter((c) => c.name === 'fillText')
        .map((c) => c.args[0])
        .join(' ')
    ).not.toContain('https://')
  })
  it('crops by node or region, refuses missing ids and does not silently substitute a different crop', () => {
    const graph = editCanvas(emptyCanvas(), [
      { op: 'add_node', node: { id: 'sample', kind: 'text', label: 'Sample', x: 100, y: 100 } },
    ]).graph
    expect(pictureRegion(graph, { node: 'sample' }).x).toBeLessThan(100)
    expect(pictureRegion(graph, { region: { x: 3, y: 4, width: 5, height: 6 } })).toEqual({
      x: 3,
      y: 4,
      width: 5,
      height: 6,
    })
    expect(() => pictureRegion(graph, { node: 'missing' })).toThrow(/missing/i)
    const { ctx } = context()
    expect(
      paintCanvas(ctx, graph, { x: -500, y: -500, width: 5, height: 5 }, theme).visible
    ).toEqual([])
  })
  it('paints bound dashed connectors, labels, arrowheads and local images', () => {
    const graph = editCanvas(emptyCanvas(), [
      { op: 'add_node', node: { id: 'a', kind: 'text', label: 'A', x: 0, y: 0 } },
      { op: 'add_node', node: { id: 'b', kind: 'note', file: 'sample-note.md', x: 500, y: 0 } },
      {
        op: 'connect',
        edge: {
          id: 'flow',
          fromNode: 'a',
          toNode: 'b',
          label: 'next',
          styleAttributes: { path: 'dashed' },
        },
      },
    ]).graph
    const { ctx, calls } = context()
    paintCanvas(ctx, graph, { x: 0, y: 0, width: 900, height: 400 }, theme, {
      contents: new Map([['b', '## Sample\nVisible note body']]),
      images: new Map([['b', [{ source: {} as CanvasImageSource, width: 40, height: 20 }]]]),
    })
    expect(calls.some((c) => c.name === 'drawImage')).toBe(true)
    expect(
      calls
        .filter((c) => c.name === 'fillText')
        .map((c) => c.args[0])
        .join(' ')
    ).toContain('Visible note body')
    expect(calls.filter((c) => c.name === 'fillText').map((c) => c.args[0])).toContain('next')
    expect(calls.some((c) => c.name === 'setLineDash' && (c.args[0] as number[]).length > 0)).toBe(
      true
    )
  })
  it.each(SHAPES)('fits long %s labels into the actual inner content box', (shape) => {
    const graph = editCanvas(emptyCanvas(), [
      {
        op: 'add_node',
        node: { id: 'sample', kind: 'shape', shape, label: 'Sample explanation '.repeat(40) },
      },
    ]).graph
    expect(lintCanvas(fitText(graph)).filter((w) => w.code === 'clipped-text')).toEqual([])
  })
  it('fits labels during layout without mutating or resizing a kept node', () => {
    const graph = editCanvas(emptyCanvas(), [
      {
        op: 'add_node',
        node: {
          id: 'sample',
          kind: 'shape',
          shape: 'diamond',
          label: 'Sample explanation '.repeat(40),
        },
      },
    ]).graph
    const before = serializeCanvas(graph)
    expect(
      lintCanvas(planCanvasLayout(graph, {})).filter((w) => w.code === 'clipped-text')
    ).toEqual([])
    expect(planCanvasLayout(graph, { keep: ['sample'] }).nodes[0].height).toBe(
      graph.nodes[0].height
    )
    fitText(graph)
    expect(serializeCanvas(graph)).toBe(before)
  })
  it('retains native geometric group membership when text fitting grows a child', () => {
    const graph = {
      nodes: [
        { id: 'group', type: 'group' as const, x: -10, y: -10, width: 400, height: 200 },
        {
          id: 'child',
          type: 'text' as const,
          text: 'Sample '.repeat(150),
          x: 0,
          y: 0,
          width: 260,
          height: 160,
        },
      ],
      edges: [],
    }
    const laid = planCanvasLayout(graph, {})
    expect(laid.nodes.find((n) => n.id === 'child')?.abele?.parent).toBe('group')
  })
  it('keeps external connections visible when a group is collapsed', () => {
    const graph = editCanvas(emptyCanvas(), [
      { op: 'add_node', node: { id: 'a', kind: 'text', label: 'Hidden sample', x: 0, y: 0 } },
      { op: 'add_node', node: { id: 'b', kind: 'text', label: 'Visible sample', x: 500, y: 0 } },
      { op: 'connect', edge: { id: 'flow', fromNode: 'a', toNode: 'b', label: 'next' } },
      { op: 'group', id: 'level', ids: ['a'] },
      { op: 'collapse', id: 'level', collapsed: true },
    ]).graph
    const { ctx, calls } = context()
    const result = paintCanvas(ctx, graph, { x: -100, y: -100, width: 1000, height: 500 }, theme)
    expect(result.visible).toEqual(['level', 'b'])
    const labels = calls.filter((c) => c.name === 'fillText').map((c) => c.args[0])
    expect(labels).toContain('next')
    expect(labels).not.toContain('Hidden sample')
  })
  it('keeps a pill label box inside the rounded silhouette and reports horizontal clipping', () => {
    const graph = editCanvas(emptyCanvas(), [
      { op: 'add_node', node: { id: 'sample', kind: 'shape', shape: 'pill', label: 'Sample' } },
    ]).graph
    const box = contentBox(graph.nodes[0]),
      radius = 80
    expect((box.x - radius) ** 2 + (box.y - radius) ** 2).toBeLessThanOrEqual(radius ** 2)
    graph.nodes[0].width = 20
    graph.nodes[0].text = '😀' // One line fits vertically, but its glyph is wider than the content box.
    expect(lintCanvas(graph).some((w) => w.code === 'clipped-text')).toBe(true)
  })
  it('places a direct-edge caption between cards and includes loop routes in the whole-picture bounds', () => {
    const graph = editCanvas(emptyCanvas(), [
      { op: 'add_node', node: { id: 'a', kind: 'text', label: 'A', x: 0, y: 0 } },
      { op: 'add_node', node: { id: 'b', kind: 'text', label: 'B', x: 500, y: 200 } },
      {
        op: 'connect',
        edge: {
          id: 'flow',
          fromNode: 'a',
          toNode: 'b',
          label: 'next',
          pathfindingMethod: 'direct',
        },
      },
      { op: 'connect', edge: { id: 'loop', fromNode: 'a', toNode: 'a' } },
    ]).graph
    const { ctx, calls } = context()
    paintCanvas(ctx, graph, pictureRegion(graph), theme)
    expect(calls.find((c) => c.name === 'fillText' && c.args[0] === 'next')?.args[2]).toBe(180)
    expect(pictureRegion(graph).y).toBeLessThanOrEqual(-40)
  })
  it('warns when a whole-node crop reduces its text below readable pixels', () => {
    expect(textResolutionWarnings(0.04, 16).map((w) => w.code)).toEqual(['unreadable-scale'])
    expect(textResolutionWarnings(1, 16)).toEqual([])
  })
  it('wraps long words without losing unicode and rejects unsupported step playback', () => {
    const text = 'Sample😀Sample😀'
    expect(
      textLines(text, 20, defaultMetrics)
        .map((l) => l.text)
        .join('')
    ).toBe(text)
    expect(() => pictureRegion(emptyCanvas(), { step: 1 })).toThrow(/stage|step|viewer/i)
  })
})
