export interface GalleryImageEntry {
  type: 'local' | 'remote'
  path: string
  alt: string
  raw: string
}

const GALLERY_HEADER_REGEX = /^::abele-gallery(?:\{([^}]*)\})?::$/
const WIKILINK_IMAGE_REGEX = /^!\[\[([^\]]+)\]\]$/
const MARKDOWN_IMAGE_REGEX = /^!\[([^\]]*)\]\(([^)]+)\)$/

export function parseGalleryHeader(line: string): { layout: string } | null {
  const match = line.trim().match(GALLERY_HEADER_REGEX)
  if (!match) return null

  const optionsStr = match[1] || ''
  let layout = 'grid'

  if (optionsStr) {
    const layoutMatch = optionsStr.match(/layout\s*=\s*(\w+)/)
    if (layoutMatch) layout = layoutMatch[1]
  }

  return { layout }
}

export function parseImageLine(line: string): GalleryImageEntry | null {
  const trimmed = line.trim()

  const wikiMatch = trimmed.match(WIKILINK_IMAGE_REGEX)
  if (wikiMatch) {
    return {
      type: 'local',
      path: wikiMatch[1],
      alt: wikiMatch[1],
      raw: trimmed,
    }
  }

  const mdMatch = trimmed.match(MARKDOWN_IMAGE_REGEX)
  if (mdMatch) {
    const isRemote = mdMatch[2].startsWith('http://') || mdMatch[2].startsWith('https://')
    return {
      type: isRemote ? 'remote' : 'local',
      path: mdMatch[2],
      alt: mdMatch[1] || mdMatch[2],
      raw: trimmed,
    }
  }

  return null
}
