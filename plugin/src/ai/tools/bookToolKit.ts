/**
 * What the book tools share: how a book is named and let be read, how a link to a place is
 * written, and how long an answer may be.
 */
import { TFile, type App } from 'obsidian'
import type { AgentToolResult } from '../client'
import { ScopeResolver } from '../ScopeResolver'
import { GlobalStore } from '@/stores/GlobalStore'
import { READER_EXTENSIONS } from '@/reader/viewType'
import { linkToPlace, parsePlaceSubpath, type BookPlace } from '@/reader/bookLinks'

/** The most text one call hands back. */
export const MAX_OUTPUT = 30_000
/** Characters of a part read when no limit is asked for. */
export const DEFAULT_CHARS = 12_000
export const MAX_CHARS = 25_000

export const answer = (body: string): AgentToolResult => ({
  content: [
    {
      type: 'text',
      text:
        body.length > MAX_OUTPUT
          ? `${body.slice(0, MAX_OUTPUT)}\n\n[Cut at ${MAX_OUTPUT} characters — ask for a smaller part.]`
          : body,
    },
  ],
})

export const app = (): App => GlobalStore.getInstance().app
export const inScope = (path: string) => ScopeResolver.getInstance().isInScope(path)

/**
 * The book a call names: a vault path, or a link to a place in it (`[[Book.epub#cfi=…]]`,
 * `Book.epub#page=4`). The place comes back too. A book outside the chat's scope is refused.
 */
export function namedBook(input: unknown): { file: TFile; place: BookPlace | null } {
  let text = typeof input === 'string' ? input.trim() : ''
  if (!text) throw new Error('Name a book: its path in the vault, or a link to a place in it.')
  const wiki = /^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(text)
  const md = /^\[[^\]]*\]\(\s*<?([^)>]+?)>?\s*\)$/.exec(text)
  text = wiki?.[1] ?? md?.[1] ?? text
  const hash = text.indexOf('#')
  const target = hash >= 0 ? text.slice(0, hash) : text
  const place = hash >= 0 ? parsePlaceSubpath(text.slice(hash)) : null
  let path = target
  try {
    path = decodeURIComponent(target)
  } catch {
    // A stray `%` written by hand: the path as it is.
  }
  const direct = app().vault.getAbstractFileByPath(path)
  const file = direct instanceof TFile ? direct : app().metadataCache.getFirstLinkpathDest(path, '')
  if (!(file instanceof TFile)) throw new Error(`No book at ${path}.`)
  if (!READER_EXTENSIONS.includes(file.extension))
    throw new Error(
      `${file.path} is not a book: the book tools read EPUB, PDF, MOBI, AZW3, FB2 and CBZ files.`
    )
  if (!inScope(file.path))
    throw new Error(`Access denied: ${file.path} is not in this chat's scope.`)
  return { file, place }
}

export const link = (file: TFile, place: BookPlace, label?: string) =>
  linkToPlace(app(), file, place, label || file.basename)

export const quoted = (text: string) =>
  text
    .split('\n')
    .map((line) => (line.trim() ? `   > ${line}` : '   >'))
    .join('\n')

/** Characters of text kept on each side of a find: a snippet of about 200 in all. */
const SIDE = 90

/**
 * The words around a find, on one line, the find in bold, cut to about `side` characters each
 * side at a word.
 */
export function snippetOf(pre: string, match: string, post: string, side = SIDE): string {
  const flat = (t: string) => t.replace(/\s+/g, ' ')
  let before = flat(pre)
  let after = flat(post)
  if (before.length > side) before = '…' + before.slice(-side).replace(/^\S*\s/, '')
  if (after.length > side) after = after.slice(0, side).replace(/\s\S*$/, '') + '…'
  return `${before}**${flat(match)}**${after}`.trim()
}
