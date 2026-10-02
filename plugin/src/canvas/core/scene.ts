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
  // These are either cubic control points or square-route corners; consumers use paintedRoute.
  return horizontal
    ? [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b]
    : [a, { x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }, b]
}
export interface PaintedRoute {
  kind: 'cubic' | 'polyline'
  points: Point[]
}
export function paintedRoute(edge: CanvasEdge, graph: CanvasGraph): PaintedRoute {
  const points = routeEdge(edge, graph)
  return {
    kind:
      points.length === 4 && (!edge.pathfindingMethod || edge.pathfindingMethod === 'bezier')
        ? 'cubic'
        : 'polyline',
    points,
  }
}
const cubicAt = (v: number[], t: number) =>
  (1 - t) ** 3 * v[0] + 3 * (1 - t) ** 2 * t * v[1] + 3 * (1 - t) * t ** 2 * v[2] + t ** 3 * v[3]
function cubicCuts(values: number[], boundary: number): number[] {
  const [a, b, c, d] = values
  const aa = -a + 3 * b - 3 * c + d,
    bb = 2 * (a - 2 * b + c),
    cc = b - a
  const critical: number[] = [0, 1]
  if (Math.abs(aa) < 1e-12) {
    if (Math.abs(bb) > 1e-12) critical.push(-cc / bb)
  } else {
    const disc = bb * bb - 4 * aa * cc
    if (disc >= 0)
      critical.push((-bb - Math.sqrt(disc)) / (2 * aa), (-bb + Math.sqrt(disc)) / (2 * aa))
  }
  const intervals = critical.filter((t) => t >= 0 && t <= 1).sort((x, y) => x - y),
    roots: number[] = []
  for (let i = 1; i < intervals.length; i++) {
    let lo = intervals[i - 1],
      hi = intervals[i],
      left = cubicAt(values, lo) - boundary,
      right = cubicAt(values, hi) - boundary
    if (Math.abs(left) < 1e-9) roots.push(lo)
    if (Math.abs(right) < 1e-9) roots.push(hi)
    if (left * right >= 0) continue
    for (let step = 0; step < 52; step++) {
      const mid = (lo + hi) / 2,
        value = cubicAt(values, mid) - boundary
      if (left * value <= 0) {
        hi = mid
        right = value
      } else {
        lo = mid
        left = value
      }
    }
    roots.push((lo + hi) / 2)
  }
  return roots
}
/** Exact parameter-interval test for a cubic centreline against a rectangle's interior. */
export function paintedRouteHits(route: PaintedRoute, rect: Rect): boolean {
  const points = route.points
  if (route.kind !== 'cubic')
    return points.slice(1).some((point, i) => segmentHits(points[i], point, rect))
  const xs = points.map((point) => point.x),
    ys = points.map((point) => point.y)
  if (
    Math.max(...xs) <= rect.x ||
    Math.min(...xs) >= rect.x + rect.width ||
    Math.max(...ys) <= rect.y ||
    Math.min(...ys) >= rect.y + rect.height
  )
    return false
  const cuts = [
    0,
    1,
    ...cubicCuts(xs, rect.x + 0.01),
    ...cubicCuts(xs, rect.x + rect.width - 0.01),
    ...cubicCuts(ys, rect.y + 0.01),
    ...cubicCuts(ys, rect.y + rect.height - 0.01),
  ].sort((a, b) => a - b)
  return cuts.slice(1).some((end, i) => {
    const t = (cuts[i] + end) / 2,
      x = cubicAt(xs, t),
      y = cubicAt(ys, t)
    return (
      x > rect.x + 0.01 &&
      x < rect.x + rect.width - 0.01 &&
      y > rect.y + 0.01 &&
      y < rect.y + rect.height - 0.01
    )
  })
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
