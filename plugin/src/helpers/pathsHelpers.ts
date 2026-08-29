/** Ensures the path ends with .md extension
 * @param path File path
 * @returns Normalized file path with .md extension
 */
export function normalizePath(path: string): string {
  // remove leading and trailing slashes and spaces
  path = path.trim().replace(/^\/+|\/+$/g, '')
  // ensure it ends with .md
  path = path.endsWith('.md') ? path : `${path}.md`

  return path
}

/** Extracts the file name from a given path with extension
 * @param path Full path to the file
 * @returns File name with extension
 */
export function getFileNameFromPath(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1]
}

/** Extracts the file name without extension from a given path
 * @param path Full path to the file
 * @returns File name without extension
 */
export function getNameFromPath(path: string): string {
  const fileName = getFileNameFromPath(path)
  return fileName.endsWith('.md') ? fileName.slice(0, -3) : fileName
}

export function getFolderFromPath(path: string): string {
  const parts = path.split('/')
  if (parts.length <= 1) {
    return ''
  }
  parts.pop() // remove file name
  return parts.join('/')
}

/** Checks if the given path is a full path (contains '/')
 * @param path File path
 * @returns True if it's a full path, false if it's just a file name
 */
export function isPath(path: string): boolean {
  return path.includes('/')
}

/** Compares two file paths for equality, normalizing them and handling name-only comparisons
 * @param pathA First file path
 * @param pathB Second file path
 * @returns True if paths are considered equal, false otherwise
 */
export function comparePaths(pathA: string, pathB: string): boolean {
  const normalizedA = normalizePath(pathA)
  const normalizedB = normalizePath(pathB)

  // if one of the paths is name only, compare by name
  if (!isPath(pathA) || !isPath(pathB)) {
    return getFileNameFromPath(normalizedA) === getFileNameFromPath(normalizedB)
  }

  return normalizedA === normalizedB
}

export function isWikilink(link: string): boolean {
  if (!link || typeof link !== 'string') return false
  return /\[\[([^\]]+)\]\]/.test(link)
}

export function wikilinkToPath(link: string): string | null {
  const match = link.match(/\[\[([^\]]+)\]\]/)
  if (match) {
    return normalizePath(match[1].split('|')[0]) // remove alias if present and normalize
  }
  return null
}

export function extractAliasOrNameFromWikilink(link: string): string | null {
  const match = link.match(/\[\[([^\]]+)\]\]/)
  if (match) {
    const parts = match[1].split('|')
    if (parts.length > 1) {
      return parts[1].trim()
    }
    return getFileNameFromPath(match[1])
  }

  return null
}

export function pathToWikilink(path: string, alias?: string): string {
  if (path.endsWith('.md')) {
    path = path.slice(0, -3)
  }
  const fileName = getFileNameFromPath(path)
  if (!alias) {
    alias = fileName
  }
  return `[[${path}|${alias}]]`
}

export function ensureWikilinkAlias(link: string): string {
  const match = link.match(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/)
  if (!match) return link
  if (match[2]) return link // already has alias
  const path = match[1]
  const name = getFileNameFromPath(path)
  return `[[${path}|${name}]]`
}

export function removeAliasFromWikilink(link: string): string {
  const match = link.match(/\[\[([^\]]+)\]\]/)
  if (match) {
    const parts = match[1].split('|')
    return `[[${parts[0].trim()}]]` // return without alias
  }
  return link
}

/**
 * Characters a file or folder name cannot carry, and why it is two groups.
 *
 * Obsidian's own new-file dialog refuses `* " \ / < > : | ?`. The rest — `#`, `^`, `[`, `]` —
 * it writes to disk without complaint, and then nothing can link to the result: `[[Note#x]]`
 * addresses a heading, `[[Note^x]]` a block, and a bracket ends the link. In a vault built on
 * links, a note nothing can point at is a note that has been lost on creation.
 */
export const FORBIDDEN_NAME_CHARS = '*"\\/<>:|?#^[]'

export function cleanFileName(fileName: string): string {
  // Remove invalid characters for file names
  return fileName
    .split('\n')[0]
    .replace(/[[\]/\\?%*:|"<>#^]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Which forbidden characters a single name carries, in the order they appear, without repeats. */
export function invalidNameChars(name: string): string[] {
  const found: string[] = []
  for (const char of name) {
    if (FORBIDDEN_NAME_CHARS.includes(char) && !found.includes(char)) found.push(char)
  }
  return found
}

/**
 * What is wrong with a path, in a sentence, or `null` when nothing is.
 *
 * Checked a segment at a time so that `/` keeps its job of separating them, and every segment
 * is checked because a folder named with a `#` breaks the links of everything inside it.
 */
export function checkVaultPath(path: string): string | null {
  const segments = path.split('/').filter(Boolean)
  if (!segments.length) return `"${path}" is not a path.`

  for (const segment of segments) {
    const bad = invalidNameChars(segment)
    if (!bad.length) continue

    const suggestion = segments
      .map((part) => cleanFileName(part))
      .filter(Boolean)
      .join('/')
    const chars = bad.map((char) => `"${char}"`).join(', ')
    const plural = bad.length > 1 ? 'characters' : 'a character'
    return (
      `"${segment}" cannot be used as a name: it contains ${chars}, ` +
      `${plural} no wikilink can point past. Try "${suggestion}".`
    )
  }

  return null
}

/**
 * Strips wikilinks (replacing with alias or name) and cleans invalid filename chars.
 * Generic version of cleanTaskName — works for any note type.
 */
export function cleanNoteName(fileName: string): string {
  const wikilinkRegex = /\[\[([^\]]+)\]\]/g
  fileName = fileName.replace(wikilinkRegex, (_, linkContent) => {
    const parts = linkContent.split('|')
    return parts.length > 1 ? parts[1].trim() : parts[0].trim()
  })

  return cleanFileName(fileName)
}

export function resolvePath(folder: string, name: string): string {
  folder = folder.trim().replace(/^\/+|\/+$/g, '') // remove leading and trailing slashes and spaces
  name = name.trim().replace(/^\/+|\/+$/g, '') // remove leading and trailing slashes and spaces

  if (folder === '') {
    return normalizePath(name)
  }

  return normalizePath(`${folder}/${name}`)
}

export function escapeRegExp(str: string): string {
  // escaping . * + ? ^ $ { } ( ) | [ ] \
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
