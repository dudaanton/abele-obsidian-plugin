import { load, dump } from 'js-yaml'
import {
  LAYOUTS,
  type Attribute,
  type Deck,
  type MarkdownBlock,
  type Slide,
  type SlideSettings,
} from './model'

const block = (source: string): MarkdownBlock => ({ type: 'markdown', source: source.trim() })
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

/** Lines where deck syntax is live; code examples and raw HTML code remain ordinary content. */
function syntaxLines(lines: string[]): boolean[] {
  let fence = '',
    length = 0,
    html = ''
  return lines.map((line) => {
    if (html) {
      if (new RegExp(`</${html}\\s*>`, 'i').test(line)) html = ''
      return false
    }
    const tag = /^ {0,3}<(pre|script|style|textarea)\b/i.exec(line)
    if (!fence && tag) {
      if (!new RegExp(`</${tag[1]}\\s*>`, 'i').test(line)) html = tag[1]
      return false
    }
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      if (marker && marker[1][0] === fence && marker[1].length >= length && !marker[2].trim())
        fence = ''
      return false
    }
    if (marker) {
      fence = marker[1][0]
      length = marker[1].length
      return false
    }
    return !/^( {4}|\t|\s*>)/.test(line)
  })
}

function parseSlide(lines: string[], sourceLine: number, css: string[]): Slide {
  const live = syntaxLines(lines)
  const first = lines.findIndex((l) => l.trim())
  const attributes = first >= 0 && live[first] ? parseSlideMarker(lines[first]) : null
  const slide: Slide = {
    settings: settings(attributes ?? {}),
    title: '',
    regions: [],
    notes: [],
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
    const line = lines[i]
    if (attributes && i === first) continue
    // Speaker notes use blockquote syntax, so intentionally inspected separately from live lines.
    if (/^ {0,3}>\s*\[!notes\][+-]?(?:\s.*)?$/i.test(line) && !insideCode(lines, i)) {
      const notes: string[] = []
      while (i + 1 < lines.length && /^ {0,3}>/.test(lines[i + 1])) {
        notes.push(lines[++i].replace(/^ {0,3}> ?/, ''))
      }
      slide.notes.push(block(notes.join('\n')))
      continue
    }
    const style = /^ {0,3}(`{3,}|~{3,})css\s*$/.exec(line)
    if (style && !insideCode(lines, i)) {
      const styles: string[] = []
      const close = new RegExp(`^ {0,3}${style[1][0]}{${style[1].length},}\\s*$`)
      while (i + 1 < lines.length && !close.test(lines[i + 1])) styles.push(lines[++i])
      if (i + 1 < lines.length) i++
      css.push(styles.join('\n').trim())
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

/** Whether this line starts in a fenced or raw HTML code block, not counting its own opener. */
function insideCode(lines: string[], index: number): boolean {
  // A sentinel has no deck syntax of its own, so its liveness reports the preceding state.
  return !syntaxLines([...lines.slice(0, index), 'sentinel'])[index]
}

export function parseDeck(source: string): Deck {
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
      deck.slides.push(parseSlide(lines.slice(from, i), from, css))
      from = i + 1
    }
  }
  deck.slides.push(parseSlide(lines.slice(from), from, css))
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
  const slides = deck.slides.map((slide) => {
    const s = slide.settings
    const attributes: Record<string, Attribute> = { ...s.attributes, layout: s.layout }
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
      out.push(...region.blocks.map((b) => b.source))
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
