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

export function buildImageLine(entry: GalleryImageEntry): string {
  if (entry.type === 'local') {
    return entry.description ? `![[${entry.path}|${entry.description}]]` : `![[${entry.path}]]`
  }
  return `![${entry.description || ''}](${entry.path})`
}
