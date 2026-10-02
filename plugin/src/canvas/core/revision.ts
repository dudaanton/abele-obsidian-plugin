import { canvasFingerprint, type CanvasGraph } from './model'

/** Opaque optimistic version of persisted bytes AND the native editor's pending data. */
export async function canvasRevision(bytes: string, graph: CanvasGraph): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify([bytes, canvasFingerprint(graph)]))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return (
    'canvas-' +
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  )
}
export const CANVAS_CONFLICT =
  'Canvas changed since the read this write was based on. Reread with canvas_read and use its new revision; no agent changes were applied.'
