/** Legacy drawing migration. Storage is supplied by the host; originals are never written. */
import { isDrawingSvg, paperOf, parseDrawingSvg } from './drawingFile'
import { serializeCanvas, type CanvasGraph } from '@/canvas/core/model'
import { inkLiteral } from '@/ink/stroke'
import { inkSchema } from '@/canvas/core/ink'

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
  const data = parseDrawingSvg(svg)
  if (!data) throw new Error('Invalid drawing metadata')
  // The legacy reader tolerates bad entries for display; migration must never silently omit one.
  const metadata = /<metadata id="abele-drawing">([\s\S]*?)<\/metadata>/.exec(svg)
  const raw = metadata ? JSON.parse(metadata[1]) : null
  if (raw?.v !== 1 || !Array.isArray(raw.items) || raw.items.length !== data.items.length)
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
  return { nodes, edges: [], abele: { ink, drawingSource: source } }
}

/** One independent, create-only publication per source. Provenance travels with the canvas. */
export async function convertDrawings(store: DrawingMigrationStore): Promise<DrawingConversion[]> {
  const paths = store.paths()
  const converted = new Map<string, string>()
  for (const path of paths.filter((p) => p.endsWith('.canvas'))) {
    try {
      const graph = JSON.parse(await store.read(path))
      if (typeof graph?.abele?.drawingSource === 'string')
        converted.set(graph.abele.drawingSource, path)
    } catch {
      /* An unrelated malformed canvas must not prevent conversion. */
    }
  }
  const results: DrawingConversion[] = []
  for (const source of paths.filter((p) => p.toLowerCase().endsWith('.svg'))) {
    try {
      const svg = await store.read(source)
      if (!isDrawingSvg(svg)) continue
      const existing = converted.get(source)
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
