/**
 * What a property's value says, read without a vault: which file a link names, what kind of file
 * that is, and how a list of files is changed. The widgets in `widgets.ts` draw from this; kept
 * apart so the rules are tested on their own.
 *
 * A property holding a file is written either way Obsidian itself writes one: as a wikilink
 * (`"[[Books/Dune.epub]]"`, which Obsidian keeps up to date when the file moves) or as a bare
 * path, the way the stock File type's own picker leaves it. Both are read.
 */

/** Where a link points, without the brackets, the display text or the heading — or null. */
export function linkTarget(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  const wiki = /^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(text)
  const target = (wiki ? wiki[1] : text).split('#')[0].trim()
  return target || null
}

/** Whether the value is written as a link rather than as words that merely look like a name. */
export function isWikilink(value: unknown): boolean {
  return typeof value === 'string' && /^!?\[\[[^\]]+\]\]$/.test(value.trim())
}

/** The entries of a Files property: a list, or one entry written on its own. Empty ones go. */
export function fileEntries(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value == null ? [] : [value]
  return list.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
}

/** The list with `entry` added at the end, unless a link to the same file is already there. */
export function withEntry(entries: string[], entry: string): string[] {
  const target = linkTarget(entry)
  if (target && entries.some((e) => linkTarget(e) === target)) return entries
  return [...entries, entry]
}

/** The list without the entry at `index`. */
export function withoutEntry(entries: string[], index: number): string[] {
  return entries.filter((_, i) => i !== index)
}

export type FileKind = 'image' | 'epub' | 'pdf' | 'note' | 'audio' | 'video' | 'other'

const KINDS: Record<string, FileKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  avif: 'image',
  epub: 'epub',
  pdf: 'pdf',
  md: 'note',
  mp3: 'audio',
  m4a: 'audio',
  wav: 'audio',
  ogg: 'audio',
  flac: 'audio',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  mkv: 'video',
}

/** What a file is, by its extension. */
export function fileKind(extension: string): FileKind {
  return KINDS[extension.toLowerCase()] ?? 'other'
}

/** The lucide icon a file card shows for its kind. */
export const KIND_ICONS: Record<FileKind, string> = {
  image: 'file-image',
  epub: 'book-open',
  pdf: 'file-text',
  note: 'file-text',
  audio: 'file-audio',
  video: 'file-video',
  other: 'file',
}

/** The property a note's picture is kept in, drawn as a card with the picture beside it. */
export const COVER_KEY = 'cover'

export function isCoverKey(key: string): boolean {
  return key.toLowerCase() === COVER_KEY
}
