/**
 * An Excalidraw drawing read out of its file, whichever of the plugin's two forms it is in:
 *
 * - a note (`Name.excalidraw.md`, or any note whose frontmatter has `excalidraw-plugin`), with
 *   `## Text Elements`, `## Embedded Files` and the scene as a fenced ```` ```json ```` or
 *   ```` ```compressed-json ```` block under a `Drawing` heading;
 * - a plain `Name.excalidraw`, the scene's JSON alone, pictures inside it as data URLs.
 *
 * Text only, no vault: what the files point at is resolved by the caller.
 */
import { decompressFromBase64 } from './lzString'

export interface ExcalidrawElement {
  [key: string]: unknown
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
}

export interface ExcalidrawFile {
  mimeType?: string
  dataURL?: string
}

export interface ExcalidrawScene {
  elements: ExcalidrawElement[]
  /** Pictures kept inside the scene, by file id: what a plain `.excalidraw` carries. */
  files: Record<string, ExcalidrawFile>
  /** `## Embedded Files` of a note: file id → `[[link]]`, `$$latex$$` or a URL, as written. */
  embedded: Map<string, string>
  /** `## Text Elements` of a note: element id → its text as the note shows it. */
  texts: Map<string, string>
}

/** Whether a file's name says it is a drawing of the Excalidraw plugin. */
export const isExcalidrawName = (path: string): boolean => /\.excalidraw(\.md)?$/i.test(path)

/** Whether a note's text is one of the plugin's drawings, by its frontmatter. */
export function isExcalidrawNote(text: string): boolean {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  return !!fm && /^excalidraw-plugin\s*:/m.test(fm[1])
}

/** The lines of a `## Section` (any heading level), up to the next heading or `%%`. */
function section(text: string, name: string): string[] {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => new RegExp(`^#{1,6}\\s+${name}\\s*$`, 'i').test(l))
  if (start < 0) return []
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line) || line.trim() === '%%') break
    out.push(line)
  }
  return out
}

function textElements(text: string): Map<string, string> {
  const out = new Map<string, string>()
  // One block per text, ending with its ` ^id`; a block may run over several lines.
  const body = section(text, 'Text Elements').join('\n')
  for (const m of body.matchAll(/([\s\S]*?) \^([\w-]{4,})\s*(?:\n\n|\n?$)/g))
    out.set(m[2], m[1].replace(/^\n+/, ''))
  return out
}

function embeddedFiles(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of section(text, 'Embedded Files')) {
    const m = /^([\w-]+):\s*(.+?)\s*$/.exec(line)
    if (m) out.set(m[1], m[2])
  }
  return out
}

/** The scene's JSON text in a note: the last fenced json block under the `Drawing` heading. */
function drawingJson(text: string): string | null {
  const at = text.search(/^#{1,6}\s+Drawing\s*$/m)
  if (at < 0) return null
  const blocks = [...text.slice(at).matchAll(/```(compressed-json|json)[^\n]*\n([\s\S]*?)\n```/g)]
  const last = blocks[blocks.length - 1]
  if (!last) return null
  return last[1] === 'json' ? last[2] : decompressFromBase64(last[2])
}

/** A scene out of a file's text; throws with a reason when there is none to be had. */
export function parseExcalidraw(text: string, path: string): ExcalidrawScene {
  const isNote = !/\.excalidraw$/i.test(path)
  const json = isNote ? drawingJson(text) : text
  if (json === null) throw new Error('No drawing data found in the file')
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('The drawing data is not valid JSON')
  }
  const scene = raw as { type?: unknown; elements?: unknown; files?: unknown }
  if (!scene || typeof scene !== 'object' || !Array.isArray(scene.elements))
    throw new Error('The drawing data has no elements')
  const elements = scene.elements.filter(
    (e): e is ExcalidrawElement =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as ExcalidrawElement).id === 'string' &&
      typeof (e as ExcalidrawElement).type === 'string' &&
      [(e as ExcalidrawElement).x, (e as ExcalidrawElement).y].every(
        (n) => typeof n === 'number' && Number.isFinite(n)
      ) &&
      (e as { isDeleted?: unknown }).isDeleted !== true
  )
  const files =
    scene.files && typeof scene.files === 'object'
      ? (scene.files as Record<string, ExcalidrawFile>)
      : {}
  return {
    elements,
    files,
    embedded: isNote ? embeddedFiles(text) : new Map(),
    texts: isNote ? textElements(text) : new Map(),
  }
}
