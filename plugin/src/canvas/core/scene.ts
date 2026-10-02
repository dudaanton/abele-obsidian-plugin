/** One geometry/text plan shared by the painter and deterministic lint. */
import {
  cloneCanvas,
  labelOf,
  type CanvasEdge,
  type CanvasGraph,
  type CanvasNode,
  type Rect,
  type Side,
} from './model'
export interface Point {
  x: number
  y: number
}
export interface TextLine {
  text: string
  bold?: boolean
  size: number
  width: number
}
export interface TextMetricsPort {
  size: number
  lineHeight: number
  measure(text: string, size: number, bold?: boolean): number
}
export const defaultMetrics: TextMetricsPort = {
  size: 16,
  lineHeight: 1.4,
  measure: (text, size) => Array.from(text).length * size * 0.58,
}
export function contentBox(node: CanvasNode): Rect {
  const shape = node.styleAttributes?.shape
  const inset =
    shape === 'diamond' || shape === 'circle' || shape === 'pill'
      ? 0.22
      : shape === 'parallelogram'
        ? 0.16
        : 0
  const verticalInset = shape === 'diamond' || shape === 'circle' || shape === 'pill' ? 0.22 : 0
  return {
    x: node.x + 16 + node.width * inset,
    y: node.y + 16 + (shape === 'database' ? 20 : node.height * verticalInset),
    width: Math.max(1, node.width * (1 - 2 * inset) - 32),
    height: Math.max(
      1,
      node.height * (1 - 2 * verticalInset) -
        32 -
        (shape === 'database' || shape === 'document' ? 20 : 0)
    ),
  }
}
export function plainMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '[image: $1]')
    .replace(/!\[\[([^\]]+)\]\]/g, '[image: $1]')
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_m, path: string, alias: string) => alias || path
    )
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`]/g, '')
}
export function textLines(
  text: string,
  width: number,
  metrics: TextMetricsPort = defaultMetrics
): TextLine[] {
  const out: TextLine[] = []
  for (const raw of text.split('\n')) {
    const heading = /^(#{1,6})\s+/.exec(raw),
      bold = !!heading || /\*\*|__/.test(raw)
    const size = heading ? metrics.size * (heading[1].length === 1 ? 1.5 : 1.2) : metrics.size
    const line = plainMarkdown(raw.replace(/^#{1,6}\s+/, '').replace(/^\s*[-*+]\s+/, '• '))
    let current = ''
    for (const word of line.split(/(\s+)/)) {
      if (current && metrics.measure(current + word, size, bold) > width) {
        out.push({
          text: current.trimEnd(),
          size,
          bold,
          width: metrics.measure(current.trimEnd(), size, bold),
        })
        current = ''
      }
      // Break long words as graphemes, not surrogate halves. They must not disappear past the clip.
      for (const character of Array.from(word)) {
        if (current && metrics.measure(current + character, size, bold) > width) {
          out.push({ text: current, size, bold, width: metrics.measure(current, size, bold) })
          current = ''
        }
        if (current || !/^\s$/.test(character)) current += character
      }
    }
    out.push({
      text: current.trimEnd(),
      size,
      bold,
      width: metrics.measure(current.trimEnd(), size, bold),
    })
  }
  return out
}
export const textHeight = (lines: TextLine[], metrics: TextMetricsPort = defaultMetrics): number =>
  lines.reduce((sum, l) => sum + l.size * metrics.lineHeight, 0)
export function endpoint(node: CanvasNode, side: Side): Point {
  const centres = {
    top: { x: node.x + node.width / 2, y: node.y },
    right: { x: node.x + node.width, y: node.y + node.height / 2 },
    bottom: { x: node.x + node.width / 2, y: node.y + node.height },
    left: { x: node.x, y: node.y + node.height / 2 },
  }
  return centres[side]
}
export function routeEdge(edge: CanvasEdge, graph: CanvasGraph): Point[] {
  const from = graph.nodes.find((n) => n.id === edge.fromNode),
    to = graph.nodes.find((n) => n.id === edge.toNode)
  if (!from || !to) return []
  if (from.id === to.id) {
    const right = endpoint(from, 'right'),
      top = endpoint(from, 'top')
    return [
      right,
      { x: right.x + 40, y: right.y },
      { x: right.x + 40, y: top.y - 40 },
      { x: top.x, y: top.y - 40 },
      top,
    ]
  }
  const dx = to.x + to.width / 2 - from.x - from.width / 2,
    dy = to.y + to.height / 2 - from.y - from.height / 2
  const aSide =
    edge.fromSide ??
    (Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top')
  const bSide =
    edge.toSide ?? ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const)[aSide]
  const a = endpoint(from, aSide),
    b = endpoint(to, bSide)
  if (edge.pathfindingMethod === 'direct') return [a, b]
  const horizontal = aSide === 'right' || aSide === 'left'
  // A square route is also the polyline used to check bezier's corridor conservatively.
  return horizontal
    ? [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b]
    : [a, { x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }, b]
}
export function segmentHits(a: Point, b: Point, r: Rect): boolean {
  // Liang-Barsky clipping, excluding contact at the border.
  let low = 0,
    high = 1
  const dx = b.x - a.x,
    dy = b.y - a.y,
    inset = 0.01
  const checks = [
    [-dx, a.x - r.x - inset],
    [dx, r.x + r.width - inset - a.x],
    [-dy, a.y - r.y - inset],
    [dy, r.y + r.height - inset - a.y],
  ]
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const t = q / p
    if (p < 0) low = Math.max(low, t)
    else high = Math.min(high, t)
    if (low > high) return false
  }
  return true
}
export function fitText(
  input: CanvasGraph,
  metrics: TextMetricsPort = defaultMetrics,
  selected: (node: CanvasNode) => boolean = () => true
): CanvasGraph {
  const graph = cloneCanvas(input)
  for (const node of graph.nodes) {
    if (node.type !== 'text' || !selected(node)) continue
    const box = contentBox(node),
      lines = textLines(labelOf(node), box.width, metrics)
    const shape = node.styleAttributes?.shape
    const ratio = shape === 'diamond' || shape === 'circle' || shape === 'pill' ? 0.56 : 1
    const padding = shape === 'database' || shape === 'document' ? 52 : 32
    const needed = (textHeight(lines, metrics) + padding) / ratio
    node.height = Math.max(node.height, needed)
  }
  return graph
}
