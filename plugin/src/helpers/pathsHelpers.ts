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
 * The same path with the unusable characters taken out — the name that will actually be made.
 *
 * Cleaned a segment at a time so that `/` keeps its job of separating them, and every segment
 * is cleaned because a folder named with a `#` breaks the links of everything inside it.
 * Only the forbidden characters go: `%`, apostrophes, commas and the rest are perfectly good
 * in a name and taking them out would be rewriting somebody's title for them.
 *
 * A segment that is nothing but forbidden characters would otherwise vanish and shorten the
 * path, so it becomes `Untitled` instead.
 */
export function toSafeVaultPath(path: string): string {
  const segments = path.split('/').filter(Boolean)

  return segments
    .map((segment) => {
      let cleaned = segment
      for (const char of FORBIDDEN_NAME_CHARS) cleaned = cleaned.split(char).join('')
      cleaned = cleaned.replace(/\s+/g, ' ').trim()
      return cleaned && cleaned !== '.md' ? cleaned : 'Untitled'
    })
    .join('/')
}

/**
 * How the name had to change, in a few words, or `null` when it did not.
 *
 * Whoever asked for the file is going to look for it under the name they gave, so a rename has
 * to come back with the result rather than only happening.
 */
export function describeRename(from: string, to: string): string | null {
  if (from === to) return null

  const bad = invalidNameChars(from.split('/').join(''))
  const chars = bad.map((char) => `"${char}"`).join(', ')
  return bad.length
    ? `renamed from "${from}": ${chars} cannot be used in a name`
    : `renamed from "${from}"`
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
