/**
 * The canvas's keys, as Obsidian Canvas, Excalidraw and tldraw have them: a letter takes a tool,
 * the same letter again takes the next of its family, arrows nudge, and the Command chords copy,
 * duplicate, stack, pick everything and frame the view. Pure: what a key means, not what it does.
 */
import type { CanvasInputTool } from './input'
import type { CanvasGraph, Rect } from './core/model'

export type CanvasKeyCommand =
  | { kind: 'tool'; tool: CanvasInputTool | 'note' }
  | { kind: 'nudge'; dx: number; dy: number }
  | {
      kind:
        | 'select-all'
        | 'duplicate'
        | 'copy'
        | 'cut'
        | 'front'
        | 'back'
        | 'fit'
        | 'fit-selection'
        | 'find'
        | 'undo'
        | 'redo'
        | 'delete'
    }

/** A tool's letter, and the family a repeated press steps through. */
const LETTERS: Record<string, CanvasInputTool[] | 'note'> = {
  v: ['select'],
  h: ['pan'],
  t: ['card'],
  n: 'note',
  r: ['shape'],
  a: ['connect', 'line', 'arrow'],
  f: ['frame'],
  p: ['pen', 'marker'],
  e: ['eraser', 'partial-eraser'],
  l: ['lasso'],
}

/** One step of an arrow key, in the canvas's own units; Shift moves ten of them. */
export const NUDGE = 10

export function canvasKey(event: KeyboardEvent, tool: CanvasInputTool): CanvasKeyCommand | null {
  const command = event.metaKey || event.ctrlKey,
    key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (command && !event.altKey) {
    if (key === 'z') return { kind: event.shiftKey ? 'redo' : 'undo' }
    if (key === 'y') return { kind: 'redo' }
    if (key === 'a') return { kind: 'select-all' }
    if (key === 'd') return { kind: 'duplicate' }
    if (key === 'c') return { kind: 'copy' }
    if (key === 'x') return { kind: 'cut' }
    if (key === 'f') return { kind: 'find' }
    if (key === ']') return { kind: 'front' }
    if (key === '[') return { kind: 'back' }
    return null
  }
  if (event.altKey) return null
  // Shift+1 and Shift+2 come as "!" and "@" on most layouts: the code says which key it was.
  if (event.shiftKey && (event.code === 'Digit1' || key === '!')) return { kind: 'fit' }
  if (event.shiftKey && (event.code === 'Digit2' || key === '@')) return { kind: 'fit-selection' }
  const step = event.shiftKey ? NUDGE * 10 : NUDGE
  if (key === 'ArrowLeft') return { kind: 'nudge', dx: -step, dy: 0 }
  if (key === 'ArrowRight') return { kind: 'nudge', dx: step, dy: 0 }
  if (key === 'ArrowUp') return { kind: 'nudge', dx: 0, dy: -step }
  if (key === 'ArrowDown') return { kind: 'nudge', dx: 0, dy: step }
  if (key === 'Delete' || key === 'Backspace') return { kind: 'delete' }
  if (event.shiftKey) return null
  const family = LETTERS[key]
  if (!family) return null
  if (family === 'note') return { kind: 'tool', tool: 'note' }
  const at = family.indexOf(tool)
  return { kind: 'tool', tool: family[at < 0 ? 0 : (at + 1) % family.length] }
}

/** The smallest frame a rectangle stands whole inside, for something put down in it. */
export function frameAround(graph: CanvasGraph, rect: Rect): string | null {
  const frames = graph.nodes
    .filter(
      (n) =>
        n.type === 'group' &&
        rect.x >= n.x &&
        rect.y >= n.y &&
        rect.x + rect.width <= n.x + n.width &&
        rect.y + rect.height <= n.y + n.height
    )
    .sort((a, b) => a.width * a.height - b.width * b.height)
  return frames[0]?.id ?? null
}

/** A web address, alone on the clipboard, becomes a link card rather than words. */
export function pastedUrl(text: string): string | null {
  const value = text.trim()
  if (!/^https?:\/\/\S+$/i.test(value)) return null
  try {
    return new URL(value).href
  } catch {
    return null
  }
}

/** A picture's extensions the canvas shows on a card. */
export const PICTURE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

/** A card for a picture: as the picture is, no wider than 400 units, nor taller than 400. */
export function pictureSize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0 && height > 0)) return { width: 320, height: 240 }
  const scale = Math.min(1, 400 / width, 400 / height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}
