/**
 * A drawing shown in a note, and which part of it: a callout of its own with the picture embedded
 * in it, the part written into the callout's header.
 *
 * ```markdown
 * > [!drawing|120 40 800 500]
 * > ![[Drawings/Sketch.svg]]
 * ```
 *
 * The part is `x y width height` in the drawing's units; without it the whole drawing shows. The
 * picture is an ordinary embed, so Obsidian follows the drawing when it is renamed and shows the
 * whole of it — in a callout — where the plugin is not there to show the part.
 *
 * Everything here works on text, so it is tested without a vault.
 */
import type { Rect } from './items'

export const DRAWING_CALLOUT = 'drawing'

/** The part of a drawing a callout's header names; null for none, or for anything else. */
export function parseView(meta: string | null | undefined): Rect | null {
  const nums = (meta ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  if (nums.length !== 4 || !nums.every(Number.isFinite)) return null
  const [x, y, w, h] = nums
  return w > 0 && h > 0 ? { x, y, w, h } : null
}

export const formatView = (r: Rect): string =>
  [r.x, r.y, r.w, r.h].map((n) => String(Math.round(n))).join(' ')

/** The callout that shows a drawing — a part of it, or all of it. */
export function drawingCallout(embed: string, view?: Rect | null): string {
  const head = view ? `> [!${DRAWING_CALLOUT}|${formatView(view)}]` : `> [!${DRAWING_CALLOUT}]`
  return `${head}\n> ${embed}`
}

const HEADER = /^(\s*>\s*\[!drawing)(\|[^\]]*)?(\][+-]?.*)$/i

/** Whether a line opens a drawing's callout. */
export const isDrawingHeader = (line: string): boolean => HEADER.test(line)

/**
 * The note with a callout's header naming another part: the callout at `line` when that line is
 * one, else the first drawing callout that embeds the file and names `was`. Null when there is
 * no such callout.
 */
export function withView(
  markdown: string,
  view: Rect | null,
  where: { line?: number; file: string; was: Rect | null }
): string | null {
  const lines = markdown.split('\n')
  const meta = view ? `|${formatView(view)}` : ''
  const set = (i: number) => {
    lines[i] = lines[i].replace(
      HEADER,
      (_, open: string, _m: string, rest: string) => `${open}${meta}${rest}`
    )
    return lines.join('\n')
  }
  if (where.line !== undefined && isDrawingHeader(lines[where.line] ?? '')) return set(where.line)
  const name = where.file.slice(where.file.lastIndexOf('/') + 1)
  const wasText = where.was ? formatView(where.was) : ''
  for (let i = 0; i < lines.length; i++) {
    const m = HEADER.exec(lines[i])
    if (!m) continue
    if ((m[2]?.slice(1).trim() ?? '') !== wasText) continue
    let end = i + 1
    while (end < lines.length && /^\s*>/.test(lines[end])) end++
    if (lines.slice(i + 1, end).some((l) => l.includes(name))) return set(i)
  }
  return null
}

/** The paper of a drawing's file — its picture's `viewBox`; null when it has none. */
export function paperOfSvg(text: string): Rect | null {
  const root = /<svg\b[^>]*>/.exec(text)?.[0] ?? ''
  return parseView(/\sviewBox="([^"]*)"/.exec(root)?.[1])
}
