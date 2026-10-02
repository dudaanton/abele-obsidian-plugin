import { describe, expect, it } from 'vitest'
import { paintCanvas, pictureRegion } from '@/canvas/core/painter'
import { editCanvas } from '@/canvas/core/edit'
import { emptyCanvas, SHAPES } from '@/canvas/core/model'
import { textLines, defaultMetrics } from '@/canvas/core/scene'

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
