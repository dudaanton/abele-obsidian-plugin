/**
 * The block at the end of a reply that is still being written, when it is one that draws
 * something — a chart, a map, a diagram, a gallery.
 *
 * Markdown closes an unclosed fence at the end of the text, so a chart whose YAML is half
 * written reaches its renderer as a whole block: it is drawn from half a config, fails with
 * a parse error, is drawn again when the next line parses, and swaps between the two with every
 * token. A diagram does the same with half a graph. While a reply streams, such a block is held
 * back and a placeholder shown in its place, and it is drawn once it is closed.
 */

import { findGalleryBlocks } from './galleryUtils'

export type UnfinishedKind = 'chart' | 'map' | 'diagram' | 'gallery'

/** The fenced languages that draw something rather than show code. */
const DRAWN: Record<string, UnfinishedKind> = {
  'abele-chart': 'chart',
  'abele-map': 'map',
  mermaid: 'diagram',
}

export interface HeldBack {
  /** What can be rendered now: the text up to the unfinished block, without the blank lines. */
  text: string
  /** What the held-back block will draw, or null when nothing is held back. */
  pending: UnfinishedKind | null
}

const FENCE = /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})[ \t]*([^\s`]*)/

/** The language a fence is still being typed towards: `abele-ch` on its way to `abele-chart`. */
const typedTowards = (lang: string): UnfinishedKind | null => {
  if (!lang) return null
  for (const [name, kind] of Object.entries(DRAWN)) if (name.startsWith(lang)) return kind
  return null
}

export function holdBackUnfinished(text: string): HeldBack {
  const lines = text.split('\n')
  let open: { marker: string; lang: string; line: number } | null = null
  /** Lines inside fences, which a gallery marker cannot be. */
  const fenced = new Set<number>()

  for (let i = 0; i < lines.length; i++) {
    const match = FENCE.exec(lines[i])
    if (!open) {
      if (match) open = { marker: match[1], lang: match[2].toLowerCase(), line: i }
      continue
    }
    fenced.add(i)
    const closing =
      match &&
      match[1][0] === open.marker[0] &&
      match[1].length >= open.marker.length &&
      !match[2] &&
      lines[i].trim() === match[1]
    if (closing) open = null
  }

  if (open) {
    const last = open.line === lines.length - 1
    const kind = DRAWN[open.lang] ?? (last ? typedTowards(open.lang) : null)
    if (!kind) return { text, pending: null }
    return { text: lines.slice(0, open.line).join('\n').trimEnd(), pending: kind }
  }

  // A gallery has no closing line: it runs for as long as picture lines follow its marker, so
  // one that reaches the end of the text may still be getting pictures.
  const galleries = findGalleryBlocks(lines.map((l, i) => (fenced.has(i) ? '' : l)))
  const last = galleries[galleries.length - 1]
  if (last && lines.slice(last.lastLine + 1).every((l) => !l.trim())) {
    return { text: lines.slice(0, last.headerLine).join('\n').trimEnd(), pending: 'gallery' }
  }
  return { text, pending: null }
}

/** What the placeholder says while the block is written. */
export const PENDING_LABEL: Record<UnfinishedKind, string> = {
  chart: 'Drawing a chart…',
  map: 'Drawing a map…',
  diagram: 'Drawing a diagram…',
  gallery: 'Gathering pictures…',
}
