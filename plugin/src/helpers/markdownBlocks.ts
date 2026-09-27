/**
 * The markdown that draws a gallery, a chart, a diagram or a map, made from data.
 *
 * Everything the plugin draws inside a note is a piece of markdown its post-processors turn
 * into a component: `::abele-gallery::`, ```` ```abele-chart ````, ```` ```mermaid ````,
 * ```` ```abele-map ````. A script view shows them the same way — as that markdown, through the
 * same renderer a note and a chat reply go through — so there is one gallery, one chart, one
 * diagram and one map in the plugin, drawn and let go by the same code wherever they appear.
 * These only write the text; nothing here draws.
 */

/**
 * A fenced code block. The fence is longer than any run of backticks inside the body, so the
 * body cannot close the block early and carry on as markdown of its own.
 */
export function fence(language: string, body: string): string {
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((run) => run.length))
  const ticks = '`'.repeat(Math.max(3, longest + 1))
  return `${ticks}${language}\n${body}\n${ticks}`
}

export type GalleryImage = string | { src: string; caption?: string }

export interface GalleryBlockOptions {
  /** `grid` (default), `masonry`, `column` or `slider`. */
  layout?: string
  /** In pixels; 400 by default. */
  height?: number
  /** `false` for no background behind the pictures. */
  bg?: boolean
}

/** One line of the text, and nothing that would make it a link, a second line or an embed's end. */
const oneLine = (text: string) => text.replace(/[\r\n]+/g, ' ').trim()
const inWikilink = (text: string) => oneLine(text).replace(/[[\]|]/g, '')

function imageLine(image: GalleryImage): string {
  const { src, caption = '' } = typeof image === 'string' ? { src: image } : image
  if (/^https?:\/\//i.test(src)) {
    // Brackets in a caption and spaces or brackets in an address would end the link early.
    const alt = oneLine(caption).replace(/[[\]]/g, '')
    return `![${alt}](${encodeURI(oneLine(src)).replace(/[()]/g, (c) => encodeURIComponent(c))})`
  }
  const name = inWikilink(src)
  const text = inWikilink(caption)
  return text ? `![[${name}|${text}]]` : `![[${name}]]`
}

/** `::abele-gallery::` and one embed per line: a vault file by its name or path, or an address. */
export function galleryBlock(images: GalleryImage[], options: GalleryBlockOptions = {}): string {
  const opts: string[] = []
  if (options.layout && /^\w+$/.test(options.layout) && options.layout !== 'grid')
    opts.push(`layout=${options.layout}`)
  if (typeof options.height === 'number' && options.height > 0 && options.height !== 400)
    opts.push(`height=${Math.round(options.height)}`)
  if (options.bg === false) opts.push('bg=false')
  const header = opts.length ? `::abele-gallery{${opts.join(',')}}::` : '::abele-gallery::'
  return [header, ...images.map(imageLine)].join('\n')
}

/**
 * An `abele-chart` block of the config, written as JSON — which is YAML, so the block reads
 * it as it reads one a person typed. See `chart_docs` for the config itself.
 */
export function chartBlock(config: object): string {
  return fence('abele-chart', JSON.stringify(config, null, 2))
}

/** A `mermaid` block of the diagram's source. */
export function mermaidBlock(source: string): string {
  return fence('mermaid', source)
}

/** An `abele-map` block of the config: `points`, `lines`, `route`, `center`, `zoom`, `height`. */
export function mapBlock(config: object): string {
  return fence('abele-map', JSON.stringify(config, null, 2))
}
