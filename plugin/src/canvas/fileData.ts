import { emptyCanvas, parseCanvas, type CanvasGraph } from './core/model'

/** Native Canvas creates zero bytes and can serialize its untouched initial state as {}. */
export function parseCanvasFile(bytes: string): CanvasGraph {
  if (bytes === '') return emptyCanvas()
  const data: unknown = JSON.parse(bytes)
  if (data && typeof data === 'object' && !Array.isArray(data) && !Object.keys(data).length)
    return emptyCanvas()
  // Never turn malformed/truncated data or an unrecognized nonempty object into a blank graph.
  // Pass the original document: parseCanvas also decodes strings, not just validates them.
  return parseCanvas(bytes)
}
