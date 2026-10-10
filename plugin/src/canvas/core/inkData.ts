import type { CanvasGraph } from './model'

type Owner = Pick<CanvasGraph, 'abele'>

/** Opaque entries are retained even when their ink schema version is unknown. */
export function rawInk(owner: Owner, writable = false): unknown[] {
  const value = owner.abele?.ink
  if (value === undefined) return []
  if (Array.isArray(value)) return value
  if (writable) throw new Error('Canvas ink has an incompatible extension container')
  return []
}

/** Even opaque entries reserve their IDs; never overwrite an unknown ink version. */
export function inkIds(graph: CanvasGraph): string[] {
  return [graph, ...graph.nodes].flatMap((owner) =>
    rawInk(owner).flatMap((v) =>
      v && typeof v === 'object' && 'id' in v && typeof v.id === 'string' ? [v.id] : []
    )
  )
}
