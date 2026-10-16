import { canvasFingerprint, type CanvasGraph } from './model'

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)])
    )
  return value
}

/** Opaque content version of persisted source AND the native editor's pending data. */
export async function canvasRevision(bytes: string, graph: CanvasGraph): Promise<string> {
  let source = bytes
  try {
    source = JSON.stringify(canonical(JSON.parse(bytes)))
  } catch {
    // Local publication review also versions malformed source, retaining its exact evidence.
  }
  const data = new TextEncoder().encode(JSON.stringify([source, canvasFingerprint(graph)]))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return (
    'canvas-' +
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  )
}
export const CANVAS_CONFLICT =
  'Canvas changed since the read this write was based on. Reread with canvas_read and use its new revision; no agent changes were applied.'
