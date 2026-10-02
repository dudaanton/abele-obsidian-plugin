import { load, dump } from 'js-yaml'
import { splitMarkdown } from '@/github/markdownBlocks'
import {
  LAYOUTS,
  type Attribute,
  type Deck,
  type MarkdownBlock,
  type SlideBlock,
  type Slide,
  type SlideSettings,
} from './model'

// Blank boundary lines are codec spacing; indentation and hard-break spaces are Markdown data.
const block = (source: string): MarkdownBlock => ({
  type: 'markdown',
  source: source.replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, ''),
})
const SEPARATOR = /^ {0,3}---\s*$/
const REGION = /^::(left|right|cell)::$/

/** Gallery-style directives; quoted values may contain spaces and escaped quotes. */
export function parseSlideMarker(line: string): Record<string, Attribute> | null {
  const marker = /^::slide(?:\{(.*)\})?::$/.exec(line.trim())
  if (!marker) return null
  const attributes: Record<string, Attribute> = {}
  const token = /([\w-]+)(?:=("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+))?/g
  for (const match of (marker[1] ?? '').matchAll(token)) {
    const value = match[2]
    attributes[match[1]] =
      value === undefined
        ? true
        : /^['"]/.test(value)
          ? value.slice(1, -1).replace(/\\(['"\\])/g, '$1')
          : value
  }
  return attributes
}

function settings(attributes: Record<string, Attribute>): SlideSettings {
  const layout = LAYOUTS.find((l) => l === attributes.layout) ?? 'content'
  const number = Number(attributes.dim ?? 0)
  return {
    layout,
    bg: String(attributes.bg ?? ''),
    dim: Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0,
    fit: attributes.fit === 'contain' ? 'contain' : 'cover',
    autoplay: attributes.autoplay === true || attributes.autoplay === 'true',
    className: typeof attributes.class === 'string' ? attributes.class : '',
    attributes,
  }
}

/** The shared block scanner is pure Markdown code, with no app or storage API. Prepending a
 * blank disables its frontmatter heuristic: the deck codec has already handled properties. */
function markdownBlocks(lines: string[]) {
  // Region directives are deck block boundaries, so they interrupt a list's lazy paragraph
  // continuation just as a heading would. Indented directives still remain inside that list.
  const scan = lines.map((line) =>
    line.replace(/^( {0,3})::(?:left|right|cell)::$/, '$1# deck-region')
  )
  return splitMarkdown('\n' + scan.join('\n')).map((block) => ({
    ...block,
    start: block.start - 2,
    end: block.end - 2,
  }))
}

/** Deck markers are only top-level syntax, never a list/quote/code example or HTML body. */
function syntaxLines(lines: string[], blocks = markdownBlocks(lines)): boolean[] {
  const live = lines.map(() => true)
  for (const block of blocks) {
    if (!['code', 'list-item', 'quote', 'html', 'math', 'footnote'].includes(block.kind)) continue
    for (let i = block.start; i <= block.end; i++) live[i] = false
  }
  return live
}

/** Walk quote/list containers structurally. Only real callouts are private; quoted or indented
 * code examples are left intact. Masking lines preserves codec locations and parent containers. */
function extractSpeakerNotes(lines: string[]): { audience: string[]; notes: MarkdownBlock[] } {
  const audience = [...lines]
  const notes: MarkdownBlock[] = []
  for (const container of markdownBlocks(lines)) {
    if (container.kind !== 'quote' && container.kind !== 'list-item') continue
    const original = lines.slice(container.start, container.end + 1)
    const prefixes: string[] = []
    const body = original.map((line, index) => {
      const prefix =
        container.kind === 'quote'
          ? (/^ {0,3}> ?/.exec(line)?.[0] ?? '')
          : index === 0
            ? (/^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(line)?.[0] ?? '')
            : (/^[ \t]*/.exec(line)?.[0].slice(0, prefixes[0].length) ?? '')
      prefixes.push(prefix)
      return line.slice(prefix.length)
    })
    if (container.kind === 'quote' && /^ {0,3}\[!notes\][+-]?(?:[ \t].*)?$/i.test(body[0])) {
      notes.push(block(body.slice(1).join('\n')))
      for (let i = container.start; i <= container.end; i++) audience[i] = ''
      continue
    }
    const inner = extractSpeakerNotes(body)
    if (!inner.notes.length) continue
    notes.push(...inner.notes)
    const empty = inner.audience.every((line) => !line.trim())
    inner.audience.forEach((line, i) => {
      audience[container.start + i] = empty
        ? ''
        : line === body[i]
          ? original[i]
          : prefixes[i] + line
    })
  }
  return { audience, notes }
}

/** Optional codec locations for source-preserving edits; never stored as deck content. */
export interface DeckLocations {
  css: { start: number; end: number }[]
}

function parseSlide(
  lines: string[],
  sourceLine: number,
  css: string[],
  locations?: DeckLocations
): Slide {
  const { audience, notes } = extractSpeakerNotes(lines)
  const blocks = markdownBlocks(lines)
  const live = syntaxLines(lines, blocks)
  const first = lines.findIndex((l) => l.trim())
  const attributes = first >= 0 && live[first] ? parseSlideMarker(lines[first]) : null
  const slide: Slide = {
    settings: settings(attributes ?? {}),
    title: '',
    regions: [],
    notes,
    sourceLine,
    ...(attributes ? { markerLine: sourceLine + first } : {}),
  }
  let region: Slide['regions'][number] = { name: 'body', blocks: [] }
  slide.regions.push(region)
  let text: string[] = []
  const flush = () => {
    if (text.join('\n').trim()) region.blocks.push(block(text.join('\n')))
    text = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = audience[i]
    if (attributes && i === first) continue
    const style = /^ {0,3}(`{3,}|~{3,})css\s*$/.exec(line)
    if (style && blocks.some((b) => b.kind === 'code' && b.start === i)) {
      const fenceStart = i
      const styles: string[] = []
      const close = new RegExp(`^ {0,3}${style[1][0]}{${style[1].length},}\\s*$`)
      while (i + 1 < lines.length && !close.test(lines[i + 1])) styles.push(lines[++i])
      if (i + 1 < lines.length) i++
      css.push(styles.join('\n').trim())
      locations?.css.push({ start: sourceLine + fenceStart, end: sourceLine + i })
      continue
    }
    const fenced = /^ {0,3}(`{3,}|~{3,})(slide-script|slide-html)\s*$/.exec(line)
    if (fenced && blocks.some((b) => b.kind === 'code' && b.start === i)) {
      flush()
      const body: string[] = []
      const close = new RegExp(`^ {0,3}${fenced[1][0]}{${fenced[1].length},}\\s*$`)
      while (i + 1 < lines.length && !close.test(lines[i + 1])) body.push(lines[++i])
      if (i + 1 < lines.length) i++
      let liveBlock: SlideBlock
      if (fenced[2] === 'slide-html') liveBlock = { type: 'html', source: body.join('\n') }
      else {
        try {
          const data = load(body.join('\n')) as Record<string, unknown>
          if (!data || typeof data.script !== 'string' || !data.script.trim())
            throw new Error('Missing script name')
          const params =
            data.params && typeof data.params === 'object' && !Array.isArray(data.params)
              ? (data.params as Record<string, unknown>)
              : {}
          const refresh =
            data.refresh === 'enter'
              ? 'enter'
              : typeof data.refresh === 'string' && /^([1-9]\d*)s$/.test(data.refresh)
                ? Number(data.refresh.slice(0, -1)) * 1000
                : 'once'
          liveBlock = { type: 'script', name: data.script, params, refresh }
        } catch {
          liveBlock = block([line, ...body, lines[i] ?? ''].join('\n'))
        }
      }
      region.blocks.push(liveBlock)
      continue
    }
    const named = live[i] ? REGION.exec(line.trim()) : null
    if (named) {
      flush()
      region = { name: named[1] as 'left' | 'right' | 'cell', blocks: [] }
      slide.regions.push(region)
      continue
    }
    if (live[i] && !slide.title) {
      const heading = /^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?$/.exec(line)
      if (heading) slide.title = heading[1]
    }
    text.push(line)
  }
  flush()
  return slide
}

export function parseDeck(source: string, locations?: DeckLocations): Deck {
  if (locations) locations.css = []
  const lines = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  let properties: Record<string, unknown> = {},
    start = 0
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && /^(-{3}|\.{3})\s*$/.test(l))
    if (end > 0) {
      // Only a valid mapping is frontmatter; an ordinary first separator is not one.
      try {
        const value = load(lines.slice(1, end).join('\n'))
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          properties = value as Record<string, unknown>
          start = end + 1
        }
      } catch {
        /* Broken YAML is shown as slide content, never discarded. */
      }
    }
  }
  const aspect =
    properties.aspect === '4:3' || properties.aspect === '9:16' ? properties.aspect : '16:9'
  const deck: Deck = {
    settings: {
      aspect,
      theme: typeof properties.theme === 'string' ? properties.theme : '',
      properties,
    },
    slides: [],
    css: '',
  }
  const css: string[] = []
  const live = syntaxLines(lines.slice(start))
  let from = start
  for (let i = start; i < lines.length; i++) {
    if (live[i - start] && SEPARATOR.test(lines[i])) {
      deck.slides.push(parseSlide(lines.slice(from, i), from, css, locations))
      from = i + 1
    }
  }
  deck.slides.push(parseSlide(lines.slice(from), from, css, locations))
  deck.css = css.filter(Boolean).join('\n\n')
  return deck
}

function quote(value: Attribute): string {
  return value === true ? '' : `="${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function serializeDeck(deck: Deck): string {
  const properties: Record<string, unknown> = {
    ...deck.settings.properties,
    type: 'presentation',
    aspect: deck.settings.aspect,
  }
  if (deck.settings.theme) properties.theme = deck.settings.theme
  else delete properties.theme
  const slides = deck.slides.map((slide) => {
    const s = slide.settings
    const attributes: Record<string, Attribute> = {
      ...Object.fromEntries(
        Object.entries(s.attributes).filter(
          ([key]) => !['layout', 'bg', 'dim', 'fit', 'autoplay', 'class'].includes(key)
        )
      ),
      layout: s.layout,
    }
    if (s.bg) attributes.bg = s.bg
    if (s.dim) attributes.dim = String(s.dim)
    if (s.fit !== 'cover') attributes.fit = s.fit
    if (s.autoplay) attributes.autoplay = true
    if (s.className) attributes.class = s.className
    const out = [
      `::slide{${Object.entries(attributes)
        .map(([key, value]) => key + quote(value))
        .join(' ')}}::`,
    ]
    for (const region of slide.regions) {
      if (region.name !== 'body') out.push(`::${region.name}::`)
      out.push(
        ...region.blocks.map((b) =>
          b.type === 'markdown'
            ? b.source
            : b.type === 'html'
              ? `\`\`\`slide-html\n${b.source}\n\`\`\``
              : `\`\`\`slide-script\n${dump({ script: b.name, params: b.params, refresh: b.refresh === 'once' || b.refresh === 'enter' ? b.refresh : `${b.refresh / 1000}s` }, { lineWidth: -1 })}\`\`\``
        )
      )
    }
    for (const note of slide.notes)
      out.push(
        `> [!notes]\n${note.source
          .split('\n')
          .map((l) => '> ' + l)
          .join('\n')}`
      )
    return out.join('\n\n')
  })
  if (deck.css) slides[slides.length - 1] += `\n\n\`\`\`css\n${deck.css}\n\`\`\``
  return `---\n${dump(properties, { lineWidth: -1 })}---\n${slides.join('\n\n---\n\n')}\n`
}
