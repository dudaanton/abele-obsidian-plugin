/**
 * Where a PDF's ink is kept, and in what form: one SVG per page, in a folder beside the book, and a
 * callout per page in the book's highlights note with the picture embedded.
 *
 * ```
 * Papers/Paper.pdf
 * Papers/Paper ink/Paper page 4.svg
 *
 * > [!ink] [[Papers/Paper.pdf#page=4|Page 4]]
 * > ![[Papers/Paper ink/Paper page 4.svg]]
 * ```
 *
 * A file's name carries the book's, so no two books' pages share one: a link Obsidian shortens to
 * the name alone, as it does when it updates links, still finds the right page.
 *
 * The picture is an ordinary SVG the size of the page, on white paper, so Obsidian shows it in the
 * note on any device, with or without the plugin, and in a dark theme too. Each stroke is a path
 * whose shape is what is shown and whose `data-` attributes are what the reader reads back: the
 * tool, the colour, the size and every point with its pressure. Only those are read — nothing of
 * the file's own markup ever goes into a page. The PDF itself is never written.
 *
 * Everything here works on text, so it is tested without a vault.
 */
import {
  MARKER_OPACITY,
  inkLiteral,
  isInkColor,
  strokePath,
  type InkStroke,
  type InkTool,
} from './stroke'

/** A page's ink: the page's size in its own units, and its strokes, oldest first. */
export interface InkPage {
  width: number
  height: number
  strokes: InkStroke[]
}

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '')
const baseOf = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '')

/** The folder a book's ink is kept in: beside the book, named after it. */
export function inkFolderOf(bookPath: string): string {
  return `${dirOf(bookPath)}${baseOf(bookPath)} ink`
}

/** The file a page's ink is kept in; `index` counts from 0, the name from 1, as pages are read. */
export function inkPathOf(bookPath: string, index: number): string {
  return `${inkFolderOf(bookPath)}/${baseOf(bookPath)} page ${index + 1}.svg`
}

/** The page a file in the book's ink folder is the ink of, counted from 0; null for anything else. */
export function inkPageOf(path: string, bookPath: string): number | null {
  const prefix = `${inkFolderOf(bookPath)}/${baseOf(bookPath)} page `
  if (!path.startsWith(prefix)) return null
  const m = /^(\d+)\.svg$/.exec(path.slice(prefix.length))
  const n = m ? Number(m[1]) : 0
  return n >= 1 ? n - 1 : null
}

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** A stroke as the path the file holds: its shape, and what it was drawn with. */
function strokeElement(stroke: InkStroke): string {
  const color = inkLiteral(stroke.color)
  const paint =
    stroke.tool === 'marker'
      ? `fill="none" stroke="${color}" stroke-opacity="${MARKER_OPACITY}" stroke-width="${stroke.size}" stroke-linecap="round" stroke-linejoin="round" style="mix-blend-mode:multiply"`
      : `fill="${color}"`
  return (
    `<path d="${esc(strokePath(stroke))}" ${paint} data-tool="${stroke.tool}" ` +
    `data-color="${stroke.color}" data-size="${stroke.size}" data-points="${stroke.points.join(' ')}"/>`
  )
}

/** The file for a page's ink. */
export function inkSvg(page: InkPage): string {
  const { width: w, height: h } = page
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" data-abele-ink="1">`,
    `<rect data-abele-paper="1" x="0" y="0" width="${w}" height="${h}" fill="#ffffff" stroke="#d4d4d4" stroke-width="1"/>`,
    ...page.strokes.map(strokeElement),
    '</svg>',
    '',
  ].join('\n')
}

const attrsOf = (tag: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = m[2]
  return out
}

const TOOLS: readonly InkTool[] = ['pen', 'marker']

/** A page's ink read back from its file; null for a file that is not the reader's. */
export function parseInkSvg(text: string): InkPage | null {
  const root = /<svg\b[^>]*>/.exec(text)
  if (!root) return null
  const attrs = attrsOf(root[0])
  if (attrs['data-abele-ink'] === undefined) return null
  const box = (attrs.viewBox ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const width = box.length === 4 ? box[2] : Number(attrs.width)
  const height = box.length === 4 ? box[3] : Number(attrs.height)
  if (!(width > 0) || !(height > 0)) return null
  const strokes: InkStroke[] = []
  for (const m of text.matchAll(/<path\b[^>]*>/g)) {
    const a = attrsOf(m[0])
    if (!TOOLS.includes(a['data-tool'] as InkTool) || a['data-points'] === undefined) continue
    const points = a['data-points'].trim().split(/\s+/).map(Number)
    if (points.length < 3 || points.length % 3 || points.some((n) => !Number.isFinite(n))) continue
    const size = Number(a['data-size'])
    strokes.push({
      tool: a['data-tool'] as InkTool,
      color: isInkColor(a['data-color']) ? a['data-color'] : 'black',
      size: size > 0 && size < 200 ? size : 2,
      points,
    })
  }
  return { width, height, strokes }
}

/** A page's callout: its link, the picture embedded under it. */
export function inkCallout(pageLink: string, svgPath: string): string {
  return `> [!ink] ${pageLink}\n> ![[${svgPath}]]`
}

const HEADER = /^>\s*\[!ink\][+-]?/i

const decoded = (text: string): string => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

interface Block {
  start: number
  end: number
  /** The picture's file name, `Paper page 4.svg`, as the embed names it. */
  name: string
  /** The book's name the file carries, and the page. */
  book: string
  page: number
}

const NAME = /([^/\n[\]()<>|]+) page (\d+)\.svg/

/** The ink callouts of a note, by the picture each embeds. */
function blocks(lines: string[]): Block[] {
  const out: Block[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!HEADER.test(lines[i])) continue
    let end = i + 1
    while (end < lines.length && /^>/.test(lines[end])) end++
    const m = NAME.exec(decoded(lines.slice(i + 1, end).join('\n')))
    const book = m ? m[1].replace(/^\s*!?\s*/, '').trim() : ''
    out.push({
      start: i,
      end,
      name: m ? `${book} page ${m[2]}.svg` : '',
      book,
      page: m ? Number(m[2]) : 0,
    })
    i = end - 1
  }
  return out
}

/** A picture's file name, and the book's name and page it carries. */
function nameOf(svgPath: string): { name: string; book: string; page: number } {
  const name = svgPath.slice(svgPath.lastIndexOf('/') + 1)
  const m = NAME.exec(name)
  return { name, book: m?.[1].trim() ?? '', page: Number(m?.[2] ?? 0) }
}

/**
 * The note with the page's callout in it: left as it is when there is one already, else put before
 * the first of the book's ink callouts of a later page, else at the end.
 */
export function upsertInkCallout(markdown: string, svgPath: string, block: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const { name, book, page } = nameOf(svgPath)
  const found = blocks(lines)
  if (found.some((b) => b.name === name)) return markdown
  const later = found.find((b) => b.book === book && b.page > page)
  if (later) {
    lines.splice(later.start, 0, ...block.split('\n'), '')
    return lines.join('\n')
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  if (lines.length) lines.push('')
  lines.push(...block.split('\n'), '')
  return lines.join('\n')
}

/** The note without the page's callout, and without the blank line it leaves behind. */
export function removeInkCallout(markdown: string, svgPath: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const block = blocks(lines).find((b) => b.name === nameOf(svgPath).name)
  if (!block) return markdown
  let { end } = block
  const { start } = block
  if (end < lines.length && !lines[end].trim() && start > 0 && !lines[start - 1].trim()) end++
  lines.splice(start, end - start)
  return lines.join('\n')
}
