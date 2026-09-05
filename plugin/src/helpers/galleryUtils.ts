export type MediaType = 'image' | 'video'

export interface GalleryImageEntry {
  type: 'local' | 'remote'
  path: string
  alt: string
  description: string
  raw: string
  mediaType: MediaType
}

const GALLERY_HEADER_REGEX = /^::abele-gallery(?:\{([^}]*)\})?::$/
const WIKILINK_IMAGE_REGEX = /^!\[\[([^\]]+)\]\]$/
const MARKDOWN_IMAGE_REGEX = /^!\[([^\]]*)\]\(([^)]+)\)$/

export interface GalleryOptions {
  layout: string
  height: number
  bg: boolean
}

export function parseGalleryHeader(line: string): GalleryOptions | null {
  const match = line.trim().match(GALLERY_HEADER_REGEX)
  if (!match) return null

  const optionsStr = match[1] || ''
  let layout = 'grid'
  let height = 400
  let bg = true

  if (optionsStr) {
    const layoutMatch = optionsStr.match(/layout\s*=\s*(\w+)/)
    if (layoutMatch) layout = layoutMatch[1]
    const heightMatch = optionsStr.match(/height\s*=\s*(\d+)/)
    if (heightMatch) height = parseInt(heightMatch[1])
    const bgMatch = optionsStr.match(/bg\s*=\s*(\w+)/)
    if (bgMatch) bg = bgMatch[1] !== 'false'
  }

  return { layout, height, bg }
}

export function parseImageLine(line: string): GalleryImageEntry | null {
  const trimmed = line.trim()

  const wikiMatch = trimmed.match(WIKILINK_IMAGE_REGEX)
  if (wikiMatch) {
    const parts = wikiMatch[1].split('|')
    const path = parts[0]
    const description = parts[1]?.trim() || ''
    return {
      type: 'local',
      path,
      alt: description || path,
      description,
      raw: trimmed,
      mediaType: getMediaType(path),
    }
  }

  const mdMatch = trimmed.match(MARKDOWN_IMAGE_REGEX)
  if (mdMatch) {
    const isRemote = mdMatch[2].startsWith('http://') || mdMatch[2].startsWith('https://')
    const description = mdMatch[1] || ''
    return {
      type: isRemote ? 'remote' : 'local',
      path: mdMatch[2],
      alt: description || mdMatch[2],
      description,
      raw: trimmed,
      mediaType: getMediaType(mdMatch[2]),
    }
  }

  return null
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'ogv']
const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]

function getExtFromPath(path: string): string {
  return path.split('.').pop()?.toLowerCase() || ''
}

export function getMediaType(path: string): MediaType {
  let ext: string
  try {
    const url = new URL(path)
    ext = getExtFromPath(url.pathname)
  } catch {
    ext = getExtFromPath(path)
  }
  return VIDEO_EXTENSIONS.includes(ext) ? 'video' : 'image'
}

export function isImageEmbed(line: string): boolean {
  const entry = parseImageLine(line.trim())
  if (!entry) return false
  if (entry.type === 'remote') {
    try {
      const pathname = new URL(entry.path).pathname
      const ext = pathname.split('.').pop()?.toLowerCase() || ''
      return MEDIA_EXTENSIONS.includes(ext)
    } catch {
      return true
    }
  }
  const ext = entry.path.split('.').pop()?.toLowerCase() || ''
  return MEDIA_EXTENSIONS.includes(ext)
}

export function buildImageLine(entry: GalleryImageEntry): string {
  if (entry.type === 'local') {
    return entry.description ? `![[${entry.path}|${entry.description}]]` : `![[${entry.path}]]`
  }
  return `![${entry.description || ''}](${entry.path})`
}

/** One gallery in a note: the header line, the image lines under it, and what the header asked for. */
export interface GalleryTextBlock extends GalleryOptions {
  /** Zero-based line of the `::abele-gallery::` header. */
  headerLine: number
  /** Zero-based line of the last image, or the header's own line when it has none. */
  lastLine: number
  images: GalleryImageEntry[]
}

/**
 * Every gallery block in a note's lines.
 *
 * A block is the header and the image lines that follow it; blank lines between images are
 * part of the block, anything else ends it. The editor extension and the reading-mode
 * post-processor both work from this, so a gallery is the same set of lines wherever it is
 * drawn.
 */
export function findGalleryBlocks(lines: string[]): GalleryTextBlock[] {
  const blocks: GalleryTextBlock[] = []
  let i = 0
  while (i < lines.length) {
    const header = parseGalleryHeader(lines[i])
    if (!header) {
      i++
      continue
    }
    const images: GalleryImageEntry[] = []
    let lastLine = i
    for (let j = i + 1; j < lines.length; j++) {
      const trimmed = lines[j].trim()
      if (trimmed === '') continue
      const image = parseImageLine(trimmed)
      if (!image) break
      images.push(image)
      lastLine = j
    }
    blocks.push({ ...header, headerLine: i, lastLine, images })
    i = lastLine + 1
  }
  return blocks
}
