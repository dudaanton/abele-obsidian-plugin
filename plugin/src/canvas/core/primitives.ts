/** Free line/arrow primitives, stored only in the JSON Canvas root extension. */
import { z } from 'zod'
import type { CanvasGraph, Rect } from './model'
import type { Point } from './scene'

const point = z.object({ x: z.number(), y: z.number() }).strict()
export const lineSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    from: point,
    to: point,
    fromEnd: z.enum(['none', 'arrow']).optional(),
    toEnd: z.enum(['none', 'arrow']).optional(),
    label: z.string().optional(),
    color: z.string().optional(),
  })
  .loose()
  .refine((l) => l.from.x !== l.to.x || l.from.y !== l.to.y, 'A line must have distinct endpoints')
export type CanvasLine = z.infer<typeof lineSchema>
export function rawLines(graph: CanvasGraph, writable = false): unknown[] {
  const lines = graph.abele?.lines
  if (lines === undefined) return []
  if (Array.isArray(lines)) return lines
  if (writable) throw new Error('Canvas lines has an incompatible extension container')
  return []
}
/** Unknown versions and malformed legacy entries remain opaque, never guessed or rewritten. */
export function linesOf(graph: CanvasGraph): CanvasLine[] {
  return rawLines(graph).flatMap((value) => {
    const parsed = lineSchema.safeParse(value)
    return parsed.success ? [parsed.data] : []
  })
}
export function lineIds(graph: CanvasGraph): string[] {
  return rawLines(graph).flatMap((value) =>
    value && typeof value === 'object' && 'id' in value && typeof value.id === 'string'
      ? [value.id]
      : []
  )
}
export function writeLines(graph: CanvasGraph, lines: unknown[]): void {
  rawLines(graph, true)
  graph.abele = { ...graph.abele, lines }
}
export function lineBounds(line: CanvasLine, fontSize = 16): Rect {
  const margin = 12,
    caption = (line.label?.length ?? 0) * fontSize,
    cx = (line.from.x + line.to.x) / 2,
    cy = (line.from.y + line.to.y) / 2,
    x = Math.min(line.from.x, line.to.x, cx - caption / 2) - margin,
    y = Math.min(line.from.y, line.to.y, cy - fontSize) - margin
  return {
    x,
    y,
    width: Math.max(line.from.x, line.to.x, cx + caption / 2) + margin - x,
    height: Math.max(line.from.y, line.to.y, cy + fontSize / 2) + margin - y,
  }
}
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}
