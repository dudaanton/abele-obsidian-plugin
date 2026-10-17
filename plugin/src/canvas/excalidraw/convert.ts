/**
 * An Excalidraw scene as an Abele canvas, and what of it did not come across.
 *
 * Shapes become shaped cards with their text in them; arrows tied to two of them become
 * connectors; every other arrow and line becomes free straight lines; pencil strokes become pen
 * ink with their pressure; frames become groups; pictures, embedded notes and links become file
 * and link cards. What the canvas has no place for — the sketchy look, fills, fonts, rotation,
 * Excalidraw's own grouping — is counted as a loss, by kind, so a person can see what to look at.
 *
 * Nothing here touches a vault: links are resolved and pictures written by the caller.
 */
import type { CanvasEdge, CanvasGraph, CanvasNode, Side } from '../core/model'
import { parseCanvas } from '../core/model'
import type { CanvasLine } from '../core/primitives'
import type { CanvasInk } from '../core/ink'
import { isExcalidrawName, type ExcalidrawElement, type ExcalidrawScene } from './source'

export interface ConvertOptions {
  /** The drawing's own vault path, kept in the canvas so it is known as migrated. */
  source: string
  /** A link target as the drawing wrote it (`Folder/Picture.png`) → its vault path, or null. */
  resolve(link: string): string | null
  /** Where a picture kept inside the drawing is to be written, by its file id and extension. */
  picturePath?(fileId: string, extension: string): string
}

export interface Loss {
  what: string
  count: number
}

/** A picture kept inside the drawing, to be written as a file of its own before the canvas. */
export interface PictureWrite {
  path: string
  dataURL: string
}

export interface Conversion {
  graph: CanvasGraph
  losses: Loss[]
  pictures: PictureWrite[]
  counts: { cards: number; connectors: number; lines: number; strokes: number }
}

/** What a canvas made from a drawing records about where it came from. */
export const SOURCE_KEY = 'excalidraw'

/** The drawing a canvas was made from, or null for any other canvas. */
export function migratedFrom(graph: { abele?: Record<string, unknown> }): string | null {
  const mark = graph.abele?.[SOURCE_KEY] as { source?: unknown } | undefined
  return typeof mark?.source === 'string' ? mark.source : null
}

const SHAPE: Record<string, string> = {
  rectangle: 'rectangle',
  ellipse: 'circle',
  diamond: 'diamond',
}

/** The words a free text card leaves round its letters. */
const PAD = 16

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const r1 = (n: number) => Math.round(n * 10) / 10

/** A colour as the canvas keeps one, `#rrggbb`; the default ink and "none" are the theme's. */
export function canvasColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  let c = value.trim().toLowerCase()
  if (/^#[0-9a-f]{3}$/.test(c)) c = '#' + [...c.slice(1)].map((d) => d + d).join('')
  if (/^#[0-9a-f]{8}$/.test(c)) c = c.slice(0, 7)
  if (!/^#[0-9a-f]{6}$/.test(c)) return undefined
  return c === '#000000' || c === '#1e1e1e' ? undefined : c
}

const filled = (el: ExcalidrawElement) => canvasColor(el.backgroundColor) !== undefined

const dash = (el: ExcalidrawElement): 'dashed' | 'dotted' | undefined =>
  el.strokeStyle === 'dashed' || el.strokeStyle === 'dotted' ? el.strokeStyle : undefined

/** A link as a card's markdown shows it. */
function linkText(link: string): string {
  if (/^!?\[\[.*\]\]$/.test(link)) return link.replace(/^!/, '')
  if (/^[a-z][\w+.-]*:\/\//i.test(link)) return `[${link}](${link})`
  return `[[${link}]]`
}

/** `[[Folder/Note#Part|alias]]` or a bare path → the target and its subpath. */
function wikiTarget(link: string): { target: string; subpath?: string } | null {
  const m = /^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(link.trim())
  const raw = m ? m[1] : /^[^:]+$/.test(link.trim()) ? link.trim() : null
  if (!raw) return null
  const hash = raw.indexOf('#')
  return hash < 0
    ? { target: raw }
    : { target: raw.slice(0, hash), subpath: raw.slice(hash) || undefined }
}

const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
}

/** The points of a line or a stroke, in the drawing's units, turned as the element is turned. */
function absolutePoints(el: ExcalidrawElement): { x: number; y: number }[] {
  const raw = Array.isArray(el.points) ? (el.points as unknown[]) : []
  const pts = raw
    .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2)
    .map(([px, py]) => ({ x: el.x + num(px), y: el.y + num(py) }))
  const angle = num(el.angle)
  if (!angle || !pts.length) return pts
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return pts.map((p) => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }))
}

/** The side of a card a point on or near its edge is at. */
function sideOf(node: CanvasNode, p: { x: number; y: number }): Side {
  const dx = (p.x - (node.x + node.width / 2)) / (node.width / 2 || 1)
  const dy = (p.y - (node.y + node.height / 2)) / (node.height / 2 || 1)
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top'
}

export function convertExcalidraw(scene: ExcalidrawScene, options: ConvertOptions): Conversion {
  const losses = new Map<string, number>()
  const lose = (what: string, n = 1) => losses.set(what, (losses.get(what) ?? 0) + n)
  const pictures: PictureWrite[] = []
  const groups: CanvasNode[] = []
  const nodes: CanvasNode[] = []
  const edges: CanvasEdge[] = []
  const lines: CanvasLine[] = []
  const ink: CanvasInk[] = []
  const used = new Set<string>()
  const uniqueId = (want: string) => {
    let id = want || 'item'
    for (let n = 2; used.has(id); n++) id = `${want}-${n}`
    used.add(id)
    return id
  }

  const byId = new Map(scene.elements.map((el) => [el.id, el]))
  /** The text tied to each shape or arrow, by its container's id. */
  const bound = new Map<string, ExcalidrawElement>()
  for (const el of scene.elements)
    if (el.type === 'text' && typeof el.containerId === 'string' && byId.has(el.containerId))
      bound.set(el.containerId, el)
  const textOf = (el: ExcalidrawElement): string => {
    const own = [el.rawText, scene.texts.get(el.id), el.originalText, el.text].find(
      (t): t is string => typeof t === 'string' && t.length > 0
    )
    return own ?? ''
  }
  /** Each element's card, by the element's id; a text tied to a shape answers with its shape's. */
  const nodeOf = new Map<string, CanvasNode>()

  const common = (el: ExcalidrawElement, kind: 'card' | 'picture' | 'line' | 'stroke') => {
    if (num(el.angle) && kind !== 'line' && kind !== 'stroke') lose('Rotation')
    // A see-through pencil stroke is a highlighter's, and becomes marker ink.
    if (num(el.opacity, 100) < 100 && kind !== 'stroke') lose('Transparency')
    if (el.locked === true) lose('Locked items (they can be moved now)')
    if (Array.isArray(el.groupIds) && el.groupIds.length) lose('Grouping (items stay apart)')
    if (num(el.roughness) > 0 && (kind === 'card' || kind === 'line')) lose('Hand-drawn look')
  }
  const box = (el: ExcalidrawElement, pad = 0) => {
    let { x, y } = el
    let w = num(el.width)
    let h = num(el.height)
    if (w < 0) [x, w] = [x + w, -w]
    if (h < 0) [y, h] = [y + h, -h]
    return {
      x: r1(x - pad),
      y: r1(y - pad),
      width: Math.max(1, r1(w + 2 * pad)),
      height: Math.max(1, r1(h + 2 * pad)),
    }
  }
  const withLink = (el: ExcalidrawElement, text: string) =>
    typeof el.link === 'string' && el.link.trim()
      ? `${text}${text ? '\n\n' : ''}${linkText(el.link.trim())}`
      : text
  const textLosses = (t: ExcalidrawElement) => {
    if ([1, 5].includes(num(t.fontFamily, 1))) lose('Handwritten font')
    const size = num(t.fontSize, 20)
    if (size < 14 || size > 28) lose('Text size')
  }
  const add = (el: ExcalidrawElement, node: Omit<CanvasNode, 'id'>, into = nodes) => {
    const made = { id: uniqueId(el.id), ...node } as CanvasNode
    into.push(made)
    nodeOf.set(el.id, made)
    return made
  }

  // Cards first, so the connectors and lines that follow can find their ends.
  for (const el of scene.elements) {
    const t = el.type
    if (SHAPE[t]) {
      common(el, 'card')
      const label = bound.get(el.id)
      if (label) textLosses(label)
      const color = canvasColor(el.strokeColor) ?? canvasColor(el.backgroundColor)
      if (filled(el)) lose('Fill colour')
      if (t === 'rectangle' && el.roundness) lose('Rounded corners')
      if (num(el.strokeWidth, 2) > 2) lose('Line width')
      const border = dash(el)
      add(el, {
        type: 'text',
        ...box(el),
        text: withLink(el, label ? textOf(label) : ''),
        ...(color ? { color } : {}),
        styleAttributes: { shape: SHAPE[t], ...(border ? { border } : {}) },
      })
      if (label) nodeOf.set(label.id, nodeOf.get(el.id))
    } else if (t === 'text' && !(typeof el.containerId === 'string' && byId.has(el.containerId))) {
      const words = textOf(el)
      if (!words.trim() && !el.link) continue
      common(el, 'card')
      textLosses(el)
      if (canvasColor(el.strokeColor)) lose('Text colour')
      add(el, {
        type: 'text',
        ...box(el, PAD),
        text: withLink(el, words),
        styleAttributes: { border: 'invisible' },
      })
    } else if (t === 'frame' || t === 'magicframe') {
      common(el, 'picture')
      const name = typeof el.name === 'string' && el.name.trim() ? el.name.trim() : 'Frame'
      add(el, { type: 'group', ...box(el), label: name }, groups)
    } else if (t === 'image') {
      common(el, 'picture')
      if (el.crop) lose('Picture crop')
      picture(el)
    } else if (t === 'embeddable') {
      common(el, 'picture')
      const link = typeof el.link === 'string' ? el.link.trim() : ''
      const wiki = /^[a-z][\w+.-]*:\/\//i.test(link) ? null : wikiTarget(link)
      const path = wiki ? options.resolve(wiki.target) : null
      if (path)
        add(el, {
          type: 'file',
          ...box(el),
          file: path,
          ...(wiki?.subpath ? { subpath: wiki.subpath } : {}),
        })
      else if (/^https?:\/\//i.test(link)) add(el, { type: 'link', ...box(el), url: link })
      else lose('Embedded note or page that could not be found')
    } else if (t === 'iframe') lose('Web elements (iframe)')
    else if (t !== 'text' && t !== 'arrow' && t !== 'line' && t !== 'freedraw')
      lose(`Unsupported element “${t}”`)
  }

  function picture(el: ExcalidrawElement): void {
    const fileId = typeof el.fileId === 'string' ? el.fileId : ''
    const written = scene.embedded.get(fileId)?.trim()
    const kept = scene.files[fileId]
    if (written && /^\$\$[\s\S]*\$\$$/.test(written)) {
      lose('LaTeX formula (now a formula in a card)')
      add(el, {
        type: 'text',
        ...box(el),
        text: `$$\n${written.slice(2, -2).trim()}\n$$`,
        styleAttributes: { border: 'invisible' },
      })
      return
    }
    if (written && /^https?:\/\//i.test(written)) {
      lose('Picture from the web (now a card showing it)')
      add(el, { type: 'text', ...box(el), text: `![](${written})` })
      return
    }
    const wiki = written ? wikiTarget(written) : null
    if (wiki) {
      const path = options.resolve(wiki.target)
      if (!path) {
        lose('Picture whose file is missing')
        return
      }
      if (isExcalidrawName(path)) lose('Drawing inside the drawing (now a file card)')
      add(el, {
        type: 'file',
        ...box(el),
        file: path,
        ...(wiki.subpath ? { subpath: wiki.subpath } : {}),
      })
      return
    }
    const mime = /^data:([^;,]+)[;,]/.exec(kept?.dataURL ?? '')?.[1] ?? kept?.mimeType ?? ''
    if (kept?.dataURL && EXTENSION[mime] && options.picturePath) {
      const path = options.picturePath(fileId || el.id, EXTENSION[mime])
      pictures.push({ path, dataURL: kept.dataURL })
      add(el, { type: 'file', ...box(el), file: path })
      return
    }
    lose('Picture whose file is missing')
  }

  for (const el of scene.elements) {
    if (el.type === 'freedraw') {
      common(el, 'stroke')
      stroke(el)
    } else if (el.type === 'arrow' || el.type === 'line') {
      common(el, 'line')
      linear(el)
    }
  }

  function stroke(el: ExcalidrawElement): void {
    const pts = absolutePoints(el)
    if (!pts.length) return
    const pressures = Array.isArray(el.pressures) ? (el.pressures as unknown[]) : []
    const simulated = el.simulatePressure !== false || pressures.length !== pts.length
    const marker = num(el.opacity, 100) < 100
    const width = num(el.strokeWidth, 2)
    // Velocity pressure follows perfect-freehand's recurrence. Keep the source
    // centreline intact: streamline/outline smoothing belongs to the ink renderer.
    let pressure = 0.5
    const simulatedPressures = pts.map((p, i) => {
      const previous = pts[Math.max(0, i - 1)]
      const speed = Math.min(
        1,
        Math.hypot(p.x - previous.x, p.y - previous.y) / Math.max(0.5, width * 4.25)
      )
      pressure += (1 - speed - pressure) * speed * 0.275
      return pressure
    })
    ink.push({
      version: 1,
      id: uniqueId(el.id),
      tool: marker ? 'marker' : 'pen',
      color: canvasColor(el.strokeColor) ?? '',
      // Excalidraw's variable freedraw uses size=strokeWidth*4.25, thinning=0.6
      // and easeOutSine. Its half-pressure diameter is size*sqrt(2), whereas
      // our pen size already denotes the half-pressure diameter.
      // https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/shape.ts
      size: marker ? Math.max(4, width * 6) : Math.max(0.5, width * 4.25 * Math.SQRT2),
      points: pts.flatMap((p, i) => [
        p.x,
        p.y,
        simulated
          ? marker
            ? 0.5
            : simulatedPressures[i]
          : Math.min(1, Math.max(0, num(pressures[i], 0.5))),
      ]),
    })
  }

  function linear(el: ExcalidrawElement): void {
    const pts = absolutePoints(el)
    if (pts.length < 2) return
    const label = bound.get(el.id)
    const text = label ? textOf(label) : undefined
    const color = canvasColor(el.strokeColor)
    const heads = [el.startArrowhead, el.endArrowhead]
    if (heads.some((h) => h !== null && h !== undefined && h !== 'arrow' && h !== 'triangle'))
      lose('Arrowhead style (now a plain arrowhead)')
    if (typeof el.link === 'string' && el.link) lose('Link on a line or a stroke')
    const binding = (b: unknown) => {
      const id = (b as { elementId?: unknown } | null)?.elementId
      return typeof id === 'string' ? nodeOf.get(id) : undefined
    }
    const from = el.type === 'arrow' ? binding(el.startBinding) : undefined
    const to = el.type === 'arrow' ? binding(el.endBinding) : undefined
    if (from && to && from !== to) {
      if (pts.length > 2 || el.elbowed) lose('Arrow route (the canvas draws its own)')
      const path = dash(el)
      edges.push({
        id: uniqueId(el.id),
        fromNode: from.id,
        toNode: to.id,
        fromSide: sideOf(from, pts[0]),
        toSide: sideOf(to, pts[pts.length - 1]),
        fromEnd: el.startArrowhead ? 'arrow' : 'none',
        toEnd: el.endArrowhead ? 'arrow' : 'none',
        ...(color ? { color } : {}),
        ...(text ? { label: text } : {}),
        ...(path ? { styleAttributes: { path } } : {}),
      })
      return
    }
    if (pts.length > 2 && el.roundness) lose('Curves (now straight lines)')
    if (el.type === 'line' && filled(el)) lose('Fill colour')
    if (dash(el)) lose('Dashed lines')
    const segments: { from: { x: number; y: number }; to: { x: number; y: number } }[] = []
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = { x: r1(pts[i].x), y: r1(pts[i].y) }
      const b = { x: r1(pts[i + 1].x), y: r1(pts[i + 1].y) }
      if (a.x !== b.x || a.y !== b.y) segments.push({ from: a, to: b })
    }
    if (!segments.length) return
    // The words go on the longest step, where they have the most room.
    const longest = segments.reduce(
      (best, s, i) =>
        Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y) >
        Math.hypot(
          segments[best].to.x - segments[best].from.x,
          segments[best].to.y - segments[best].from.y
        )
          ? i
          : best,
      0
    )
    segments.forEach((s, i) => {
      lines.push({
        version: 1,
        id: uniqueId(i ? `${el.id}-${i}` : el.id),
        from: s.from,
        to: s.to,
        ...(i === 0 && el.startArrowhead ? { fromEnd: 'arrow' as const } : {}),
        ...(i === segments.length - 1 && el.type === 'arrow' && el.endArrowhead
          ? { toEnd: 'arrow' as const }
          : {}),
        ...(text && i === longest ? { label: text } : {}),
        ...(color ? { color } : {}),
      })
    })
  }

  const graph: CanvasGraph = {
    nodes: [...groups, ...nodes],
    edges,
    abele: {
      ...(lines.length ? { lines } : {}),
      ...(ink.length ? { ink } : {}),
      [SOURCE_KEY]: { source: options.source },
    },
  }
  return {
    graph: parseCanvas(JSON.parse(JSON.stringify(graph))),
    losses: [...losses].map(([what, count]) => ({ what, count })),
    pictures,
    counts: {
      cards: groups.length + nodes.length,
      connectors: edges.length,
      lines: lines.length,
      strokes: ink.length,
    },
  }
}
