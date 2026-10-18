/** Legacy drawing migration. Storage is supplied by the host; originals are never written. */
import { isDrawingSvg, paperOf, parseDrawingSvg } from './drawingFile'
import { serializeCanvas, type CanvasGraph } from '@/canvas/core/model'
import { inkLiteral, isInkColor } from '@/ink/stroke'
import { inkSchema } from '@/canvas/core/ink'
import { z } from 'zod'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'

const sourceHash = (svg: string): string => bytesToHex(sha256(new TextEncoder().encode(svg)))

const size = z.number().min(0.05).max(2000)
const coordinate = z.number().min(-1e7).max(1e7)
const base = { id: z.string().regex(/^[\w-]{1,40}$/) }
const colored = { ...base, color: z.custom<string>(isInkColor), size }
const triples = z
  .array(z.number())
  .min(3)
  .refine((p) => p.length % 3 === 0)
const rawItem = z.discriminatedUnion('type', [
  z
    .object({
      ...colored,
      type: z.literal('stroke'),
      tool: z.enum(['pen', 'marker']),
      linear: z.boolean().optional(),
      freedraw: z
        .object({ simulatePressure: z.boolean(), streamline: z.number().min(0).max(1) })
        .optional(),
      points: triples
        .refine((p) => p.every((v, i) => i % 3 !== 2 || (v >= 0 && v <= 1)))
        .optional(),
      d: triples
        .refine((p) => {
          let pressure = 0
          return p.every((v, i) => {
            if (i % 3 !== 2) return true
            pressure += v
            return Number.isInteger(v) && pressure >= 0 && pressure <= 100
          })
        })
        .optional(),
    })
    .refine((item) => item.d !== undefined || item.points !== undefined),
  z.object({
    ...colored,
    type: z.literal('shape'),
    kind: z.enum(['rect', 'ellipse', 'line', 'arrow']),
    x1: coordinate,
    y1: coordinate,
    x2: coordinate,
    y2: coordinate,
  }),
  z.object({
    ...colored,
    type: z.literal('text'),
    x: coordinate,
    y: coordinate,
    text: z.string().min(1).max(20000),
  }),
  z.object({
    ...base,
    type: z.literal('note'),
    x: coordinate,
    y: coordinate,
    w: z.number().min(1).max(1e6),
    h: z.number().min(1).max(1e6),
    scale: z.number().min(0.001).max(1000),
    path: z.string().min(1).max(999),
  }),
])

export interface DrawingMigrationStore {
  paths(): string[]
  read(path: string): Promise<string>
  exists(path: string): boolean
  create(path: string, text: string): Promise<void>
}
export interface DrawingConversion {
  source: string
  destination?: string
  status: 'converted' | 'existing' | 'failed'
  error?: string
}

export function drawingCanvas(source: string, svg: string): CanvasGraph {
  // The legacy reader tolerates bad entries for display; migration must never silently omit one.
  const metadata = /<metadata id="abele-drawing">([\s\S]*?)<\/metadata>/.exec(svg)
  const raw = metadata ? JSON.parse(metadata[1]) : null
  if (raw?.v !== 1 || !z.array(rawItem).safeParse(raw.items).success)
    throw new Error('Unsupported or incomplete drawing metadata')
  const data = parseDrawingSvg(svg)
  if (!data || raw.items.length !== data.items.length)
    throw new Error('Unsupported or incomplete drawing metadata')
  const ink = data.items.flatMap((item) => {
    if (item.type !== 'stroke') return []
    const { type: _type, ...stroke } = item
    return [inkSchema.parse({ ...stroke, color: inkLiteral(stroke.color), version: 1 })]
  })
  const paper = paperOf(data.items)
  // Canvas ink has no equivalent for legacy text/shape/note layering. Keep an exact source
  // preview alongside editable strokes rather than approximating or dropping that content.
  const nodes: CanvasGraph['nodes'] = data.items.some((item) => item.type !== 'stroke')
    ? [
        {
          id: 'legacy-source',
          type: 'file',
          file: source,
          x: paper.x + paper.w + 80,
          y: paper.y,
          width: paper.w,
          height: paper.h,
        },
      ]
    : []
  return {
    nodes,
    edges: [],
    abele: { ink, drawingSource: source, drawingSourceHash: sourceHash(svg) },
  }
}

/** One independent, create-only publication per source. Provenance travels with the canvas. */
export async function convertDrawings(store: DrawingMigrationStore): Promise<DrawingConversion[]> {
  const paths = store.paths()
  const converted = new Map<string, string>()
  const identities = new Map<string, { source: string; destination: string }[]>()
  for (const path of paths.filter((p) => p.endsWith('.canvas'))) {
    try {
      const graph = JSON.parse(await store.read(path))
      if (typeof graph?.abele?.drawingSource === 'string') {
        converted.set(graph.abele.drawingSource, path)
        const hash = graph.abele.drawingSourceHash
        if (typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))
          identities.set(hash, [
            ...(identities.get(hash) ?? []),
            { source: graph.abele.drawingSource, destination: path },
          ])
      }
    } catch {
      /* An unrelated malformed canvas must not prevent conversion. */
    }
  }
  const results: DrawingConversion[] = []
  for (const source of paths.filter((p) => p.toLowerCase().endsWith('.svg'))) {
    try {
      const svg = await store.read(source)
      if (!isDrawingSvg(svg)) continue
      // Identical files that still coexist are separate drawings, not a rename.
      const existing =
        converted.get(source) ??
        identities.get(sourceHash(svg))?.find((entry) => !store.exists(entry.source))?.destination
      if (existing) {
        results.push({ source, destination: existing, status: 'existing' })
        continue
      }
      const text = serializeCanvas(drawingCanvas(source, svg))
      const base = source.slice(0, -4)
      let destination = `${base}.canvas`
      for (let n = 2; store.exists(destination); n++) destination = `${base} ${n}.canvas`
      await store.create(destination, text)
      converted.set(source, destination)
      results.push({ source, destination, status: 'converted' })
    } catch (error) {
      results.push({ source, status: 'failed', error: String(error) })
    }
  }
  return results
}
