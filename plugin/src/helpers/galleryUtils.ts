export interface GalleryImageEntry {
  type: 'local' | 'remote'
  path: string
  alt: string
  description: string
  raw: string
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
    }
  }

  return null
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']

export function isImageEmbed(line: string): boolean {
  const entry = parseImageLine(line.trim())
  if (!entry) return false
  if (entry.type === 'remote') {
    // Remote URLs: check extension or assume image
    try {
      const pathname = new URL(entry.path).pathname
      const ext = pathname.split('.').pop()?.toLowerCase() || ''
      return IMAGE_EXTENSIONS.includes(ext)
    } catch {
      return true // can't parse URL, assume image
    }
  }
  // Local: check extension in path (before alias separator |)
  const ext = entry.path.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTENSIONS.includes(ext)
}

export function buildImageLine(entry: GalleryImageEntry): string {
  if (entry.type === 'local') {
    return entry.description ? `![[${entry.path}|${entry.description}]]` : `![[${entry.path}]]`
  }
  return `![${entry.description || ''}](${entry.path})`
}
