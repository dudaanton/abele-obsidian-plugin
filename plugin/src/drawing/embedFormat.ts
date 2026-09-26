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

/**
 * The size a drawing is shown at in a note, in pixels: Obsidian's own for any picture, written in
 * the embed — `![[Sketch.svg|300]]` for a width, `![[Sketch.svg|300x200]]` for a box.
 */
export interface EmbedSize {
  w: number
  h?: number
}

const SIZE = /^\s*(\d+(?:\.\d+)?)\s*(?:x\s*(\d+(?:\.\d+)?)\s*)?$/

/** A size read from an embed's alias or Obsidian's `width`/`height`; null for anything else. */
export function parseEmbedSize(text: string | null | undefined): EmbedSize | null {
  const m = SIZE.exec(text ?? '')
  if (!m) return null
  const w = Number(m[1])
  const h = m[2] === undefined ? undefined : Number(m[2])
  if (!(w > 0) || (h !== undefined && !(h > 0))) return null
  return h === undefined ? { w } : { w, h }
}

export const formatEmbedSize = (s: EmbedSize): string =>
  s.h === undefined ? `${Math.round(s.w)}` : `${Math.round(s.w)}x${Math.round(s.h)}`

/** The tallest a drawing is shown by default, however tall it is: taller is asked for by a size. */
export const DEFAULT_EMBED_HEIGHT = 360
/** The smallest box shown, so a drawing of a dot can still be seen and its buttons pressed. */
const MIN_W = 120
const MIN_H = 80
/** The tallest a width alone makes it. */
const MAX_H = 1200

/**
 * The box a drawing's part is shown in, `room` wide at most: the size the embed names, the height
 * following the part when only a width is named; without one, the part at its own size — never
 * larger — within the room and the default height.
 */
export function embedBox(
  room: number,
  shown: Rect,
  size: EmbedSize | null
): { w: number; h: number } {
  const out = (w: number, h: number) => ({ w: Math.round(w), h: Math.round(h) })
  if (size) {
    const w = Math.min(size.w, room)
    if (size.h !== undefined) return out(w, (size.h * w) / size.w)
    return out(w, Math.min(MAX_H, Math.max(MIN_H, (w * shown.h) / shown.w)))
  }
  const s = Math.min(1, room / shown.w, DEFAULT_EMBED_HEIGHT / shown.h)
  return out(Math.max(Math.min(room, MIN_W), shown.w * s), Math.max(MIN_H, shown.h * s))
}

const WIKI_EMBED = /!\[\[([^\]]+?)\]\]/g
const MD_EMBED = /!\[([^\]]*)\]\(([^)]+)\)/g

const nameOf = (target: string): string => {
  let t = target.trim().replace(/^<|>$/g, '')
  try {
    t = decodeURI(t)
  } catch {
    // Kept as written.
  }
  return t.split('#')[0].split('/').pop() ?? ''
}

/** An alias's parts without the size, with `size` at the end when there is one. */
const sized = (parts: string[], size: EmbedSize | null): string[] => {
  const rest = parts.filter((p) => !parseEmbedSize(p))
  return size ? [...rest, formatEmbedSize(size)] : rest
}

/**
 * The note with the size of one embed of a file changed: the `nth` of the file's embeds from line
 * `from` through `to` — through the end of the callout when `from` opens one and `to` is not
 * given, else that line alone. Null when there is no such embed.
 */
export function withEmbedSize(
  markdown: string,
  where: { from: number; to?: number; file: string; nth: number },
  size: EmbedSize | null
): string | null {
  const lines = markdown.split('\n')
  const name = where.file.slice(where.file.lastIndexOf('/') + 1)
  let to = where.to ?? where.from
  if (where.to === undefined && /^\s*>/.test(lines[where.from] ?? ''))
    while (to + 1 < lines.length && /^\s*>/.test(lines[to + 1])) to++
  let seen = 0
  for (let i = where.from; i <= to && i < lines.length; i++) {
    const found: { at: number; len: number; text: string }[] = []
    for (const m of lines[i].matchAll(WIKI_EMBED)) {
      const [target, ...alias] = m[1].split('|')
      if (nameOf(target) !== name) continue
      found.push({
        at: m.index,
        len: m[0].length,
        text: `![[${[target, ...sized(alias, size)].join('|')}]]`,
      })
    }
    for (const m of lines[i].matchAll(MD_EMBED)) {
      if (nameOf(m[2].split(/\s+"/)[0]) !== name) continue
      const alt = sized(m[1] ? m[1].split('|') : [], size).join('|')
      found.push({ at: m.index, len: m[0].length, text: `![${alt}](${m[2]})` })
    }
    found.sort((a, b) => a.at - b.at)
    for (const f of found) {
      if (seen++ !== where.nth) continue
      lines[i] = lines[i].slice(0, f.at) + f.text + lines[i].slice(f.at + f.len)
      return lines.join('\n')
    }
  }
  return null
}
