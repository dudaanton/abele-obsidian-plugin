/** Canvas 2D graph painter. The host supplies its theme, note text, and local image assets. */
import { arrowHead } from '../../drawing/items'
import {
  bounds,
  canvasPaintOrder,
  descendants,
  labelOf,
  overlaps,
  parentsOf,
  type CanvasGraph,
  type CanvasNode,
  type Rect,
} from './model'
import { lintCanvas, type CanvasWarning } from './lint'
import { contentBox, routeEdge, textLines, type Point, type TextMetricsPort } from './scene'
export interface CanvasTheme {
  paper: string
  card: string
  text: string
  border: string
  accent: string
  muted: string
  font: string
  size: number
  lineHeight: number
  presets: string[]
}
export interface ImageAsset {
  source: CanvasImageSource
  width: number
  height: number
}
export interface CanvasAssets {
  contents?: ReadonlyMap<string, string>
  images?: ReadonlyMap<string, ImageAsset[]>
}
export function pictureRegion(
  graph: CanvasGraph,
  options: { region?: Rect; node?: string; step?: number } = {}
): Rect {
  if (options.step !== undefined)
    throw new Error('Step playback requires the later canvas viewer; use node or region for now')
  if (options.region && options.node) throw new Error('Choose node or region, not both')
  const region =
    options.region ??
    (options.node
      ? graph.nodes.find((n) => n.id === options.node)
      : bounds(
          [
            ...graph.nodes,
            ...graph.edges
              .flatMap((edge) => routeEdge(edge, graph))
              .map((point) => ({ ...point, width: 1, height: 1 })),
          ],
          24
        ))
  if (!region) throw new Error(`Unknown canvas node ${options.node}`)
  if (
    ![region.x, region.y, region.width, region.height].every(Number.isFinite) ||
    region.width <= 0 ||
    region.height <= 0
  )
    throw new Error('Region must be finite with positive width and height')
  return options.node
    ? bounds([region], 24)
    : { x: region.x, y: region.y, width: region.width, height: region.height }
}
export function textResolutionWarnings(scale: number, fontSize: number): CanvasWarning[] {
  return scale * fontSize < 8
    ? [
        {
          code: 'unreadable-scale',
          ids: [],
          message:
            'Text is below 8 pixels in this picture; inspect a smaller region rather than the whole node or diagram',
        },
      ]
    : []
}
export function canvasMetrics(ctx: CanvasRenderingContext2D, theme: CanvasTheme): TextMetricsPort {
  return {
    size: theme.size,
    lineHeight: theme.lineHeight,
    measure: (text, size, bold) => {
      ctx.font = `${bold ? '600 ' : ''}${size}px ${theme.font}`
      return ctx.measureText(text).width
    },
  }
}
const colorOf = (color: unknown, fallback: string, theme: CanvasTheme) =>
  typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)
    ? color
    : typeof color === 'string' && /^[1-6]$/.test(color)
      ? theme.presets[Number(color) - 1] || fallback
      : fallback
function shapePath(ctx: CanvasRenderingContext2D, node: CanvasNode): void {
  const { x, y, width: w, height: h } = node,
    shape = node.styleAttributes?.shape
  ctx.beginPath()
  if (shape === 'circle') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  else if (shape === 'diamond') {
    ctx.moveTo(x + w / 2, y)
    ctx.lineTo(x + w, y + h / 2)
    ctx.lineTo(x + w / 2, y + h)
    ctx.lineTo(x, y + h / 2)
    ctx.closePath()
  } else if (shape === 'parallelogram') {
    ctx.moveTo(x + w * 0.15, y)
    ctx.lineTo(x + w, y)
    ctx.lineTo(x + w * 0.85, y + h)
    ctx.lineTo(x, y + h)
    ctx.closePath()
  } else if (shape === 'document') {
    ctx.moveTo(x, y)
    ctx.lineTo(x + w, y)
    ctx.lineTo(x + w, y + h - 12)
    ctx.bezierCurveTo(x + w * 0.65, y + h + 12, x + w * 0.35, y + h - 36, x, y + h - 12)
    ctx.closePath()
  } else if (shape === 'database') {
    ctx.moveTo(x, y + 12)
    ctx.bezierCurveTo(x, y - 4, x + w, y - 4, x + w, y + 12)
    ctx.lineTo(x + w, y + h - 12)
    ctx.bezierCurveTo(x + w, y + h + 4, x, y + h + 4, x, y + h - 12)
    ctx.closePath()
  } else ctx.roundRect(x, y, w, h, shape === 'pill' ? Math.min(w, h) / 2 : 6)
}
function arrow(ctx: CanvasRenderingContext2D, from: Point, to: Point, style: unknown): void {
  const size = arrowHead(1.5),
    angle = Math.atan2(to.y - from.y, to.x - from.x)
  ctx.save()
  ctx.translate(to.x, to.y)
  ctx.rotate(angle)
  ctx.beginPath()
  if (style === 'circle') ctx.arc(-size / 2, 0, size / 2, 0, Math.PI * 2)
  else if (style === 'diamond') {
    ctx.moveTo(0, 0)
    ctx.lineTo(-size / 2, size / 2)
    ctx.lineTo(-size, 0)
    ctx.lineTo(-size / 2, -size / 2)
    ctx.closePath()
  } else if (style === 'bar' || style === 't-shaped') {
    ctx.moveTo(0, -size / 2)
    ctx.lineTo(0, size / 2)
    ctx.stroke()
    ctx.restore()
    return
  } else if (style === 'square') ctx.rect(-size, -size / 2, size, size)
  else {
    ctx.moveTo(0, 0)
    ctx.lineTo(-size, size / 2)
    ctx.lineTo(-size, -size / 2)
    ctx.closePath()
  }
  ctx.fill()
  ctx.restore()
}
export function paintCanvas(
  ctx: CanvasRenderingContext2D,
  graph: CanvasGraph,
  region: Rect,
  theme: CanvasTheme,
  assets: CanvasAssets = {}
) {
  const metrics = canvasMetrics(ctx, theme),
    warnings = lintCanvas(graph, metrics, assets.contents),
    parents = parentsOf(graph)
  const hidden = new Set(
    graph.nodes
      .filter((n) => n.type === 'group' && n.collapsed)
      .flatMap((n) => descendants(n.id, parents))
  )
  const visible = canvasPaintOrder(graph).filter((n) => !hidden.has(n.id) && overlaps(n, region))
  ctx.save()
  ctx.beginPath()
  ctx.rect(region.x, region.y, region.width, region.height)
  ctx.clip()
  ctx.fillStyle = theme.paper
  ctx.fillRect(region.x, region.y, region.width, region.height)
  for (const node of visible.filter((n) => n.type === 'group')) {
    ctx.strokeStyle = colorOf(node.color, theme.border, theme)
    ctx.fillStyle = theme.muted
    ctx.lineWidth = 1
    ctx.setLineDash([])
    shapePath(ctx, node)
    ctx.stroke()
    ctx.font = `600 ${theme.size}px ${theme.font}`
    ctx.fillText(node.label ?? node.id, node.x + 12, node.y + theme.size + 8)
  }
  const representative = (id: string): string => {
    while (hidden.has(id)) {
      const parent = parents.get(id)
      if (!parent) break
      id = parent
    }
    return id
  }
  for (const edge of graph.edges) {
    const fromNode = representative(edge.fromNode),
      toNode = representative(edge.toNode)
    if (fromNode === toNode && (fromNode !== edge.fromNode || toNode !== edge.toNode)) continue
    const points = routeEdge(
      {
        ...edge,
        fromNode,
        toNode,
        fromSide: fromNode === edge.fromNode ? edge.fromSide : undefined,
        toSide: toNode === edge.toNode ? edge.toSide : undefined,
      },
      graph
    )
    if (!points.length) continue
    const path = edge.styleAttributes?.path
    ctx.setLineDash(path === 'dashed' ? [8, 5] : path === 'dotted' ? [2, 5] : [])
    ctx.lineWidth = 1.5
    ctx.strokeStyle = colorOf(edge.color, theme.border, theme)
    ctx.fillStyle = ctx.strokeStyle
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    if ((edge.pathfindingMethod === 'bezier' || !edge.pathfindingMethod) && points.length === 4)
      ctx.bezierCurveTo(
        points[1].x,
        points[1].y,
        points[2].x,
        points[2].y,
        points[3].x,
        points[3].y
      )
    else for (const point of points.slice(1)) ctx.lineTo(point.x, point.y)
    ctx.stroke()
    ctx.setLineDash([])
    const end = points[points.length - 1],
      before =
        [...points.slice(0, -1)].reverse().find((p) => p.x !== end.x || p.y !== end.y) ?? points[0]
    if (edge.toEnd !== 'none') arrow(ctx, before, end, edge.styleAttributes?.arrow)
    if (edge.fromEnd === 'arrow') arrow(ctx, points[1], points[0], edge.styleAttributes?.arrow)
    if (edge.label) {
      const first = points[0],
        last = points[points.length - 1]
      const middle =
        points.length === 5 ? points[2] : { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 }
      ctx.font = `${theme.size}px ${theme.font}`
      const width = ctx.measureText(edge.label).width
      ctx.fillStyle = theme.paper
      ctx.fillRect(middle.x - width / 2 - 4, middle.y - theme.size, width + 8, theme.size * 1.4)
      ctx.fillStyle = theme.text
      ctx.fillText(edge.label, middle.x - width / 2, middle.y)
    }
  }
  for (const node of visible.filter((n) => n.type !== 'group')) {
    ctx.save()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = colorOf(node.color, theme.border, theme)
    ctx.fillStyle = theme.card
    ctx.setLineDash(
      node.styleAttributes?.border === 'dashed'
        ? [8, 5]
        : node.styleAttributes?.border === 'dotted'
          ? [2, 5]
          : []
    )
    shapePath(ctx, node)
    ctx.fill()
    if (node.styleAttributes?.border !== 'invisible') ctx.stroke()
    ctx.clip()
    ctx.setLineDash([])
    if (node.styleAttributes?.shape === 'predefined-process') {
      for (const x of [node.x + 12, node.x + node.width - 12]) {
        ctx.beginPath()
        ctx.moveTo(x, node.y)
        ctx.lineTo(x, node.y + node.height)
        ctx.stroke()
      }
    }
    if (node.styleAttributes?.shape === 'database') {
      ctx.beginPath()
      ctx.ellipse(node.x + node.width / 2, node.y + 12, node.width / 2, 12, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    const box = contentBox(node)
    ctx.beginPath()
    ctx.rect(box.x, box.y, box.width, box.height)
    ctx.clip()
    const text = assets.contents?.get(node.id) ?? labelOf(node),
      lines = textLines(text, box.width, metrics)
    let y = box.y
    ctx.fillStyle = theme.text
    ctx.textBaseline = 'alphabetic'
    for (const line of lines) {
      ctx.font = `${line.bold ? '600 ' : ''}${line.size}px ${theme.font}`
      const x =
        node.textAlign === 'center'
          ? box.x + (box.width - line.width) / 2
          : node.textAlign === 'right'
            ? box.x + box.width - line.width
            : box.x
      ctx.fillText(line.text, x, y + line.size)
      y += line.size * theme.lineHeight
    }
    for (const image of assets.images?.get(node.id) ?? []) {
      const scale = Math.min(1, box.width / image.width),
        width = image.width * scale,
        height = image.height * scale
      if (y + height > box.y + box.height)
        warnings.push({
          code: 'clipped-image',
          ids: [node.id],
          message: `${node.id}: image exceeds its content box`,
        })
      ctx.drawImage(image.source, box.x, y, width, height)
      y += height + 8
    }
    ctx.restore()
  }
  ctx.restore()
  return { visible: visible.map((n) => n.id), warnings }
}
