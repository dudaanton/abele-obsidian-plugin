/**
 * What a script wants to know about a note before it puts the note on a card.
 *
 * `read()` gives the file as written, and that is the wrong starting point for a feed or a
 * deck: the frontmatter is in it, the gallery marker is in it, the picture is a link name
 * rather than a path, and the first lines of prose are behind all of that. Every script that
 * drew cards from notes has re-derived these by hand and got some of them wrong — the
 * marker printed as text, the cover a broken image — so the plugin does it once, the way it
 * does for its own footers.
 */
import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { parseGalleryHeader } from '@/helpers/galleryUtils'
import { resolveVaultFile } from '@/helpers/resourceUrl'

export interface NoteInfo {
  path: string
  /** The file name without its extension. */
  name: string
  folder: string
  /** `title` from the frontmatter when there is one, else the name. */
  title: string
  frontmatter: Record<string, unknown>
  /** Tags from the frontmatter and the body, without `#`, each once. */
  tags: string[]
  /** ISO timestamps from the file system. */
  created: string
  modified: string
  /** The first picture: the frontmatter `cover`, else the first image embed. A vault path. */
  cover: string | null
  /** The markdown without its frontmatter — what `Markdown` should render. */
  body: string
  /** The body as prose: no markup, no embeds, no markers. Lines kept. */
  text: string
  /** The first sentences of `text`, cut at a word. */
  excerpt: string
  words: number
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']
const EXCERPT_LENGTH = 280

export function stripFrontmatter(raw: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw)
  return match ? raw.slice(match[0].length) : raw
}

/**
 * The prose of a note, with the markup taken off.
 *
 * Line structure survives — a list item stays a line — because an excerpt reads better with
 * its breaks than as one run-on sentence. Wikilinks keep their alias or name, markdown
 * links keep their text, embeds and gallery markers go entirely, and a code block goes with
 * them: code is not something a card summarises.
 */
export function plainText(body: string): string {
  const lines: string[] = []
  let inCode = false
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (/^(```|~~~)/.test(line)) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    if (parseGalleryHeader(line)) continue
    if (/^!\[\[[^\]]*\]\]$/.test(line) || /^!\[[^\]]*\]\([^)]*\)$/.test(line)) continue
    if (/^%%.*%%$/.test(line)) continue
    if (/^\|.*\|$/.test(line) && /^[|\s:-]+$/.test(line)) continue
    const text = line
      .replace(/!\[\[[^\]]*\]\]/g, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(
        /\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g,
        (_m, target: string, alias?: string) => (alias ?? target).trim()
      )
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
      .replace(/^\|(.*)\|$/, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(\S(?:.*?\S)?)\1/g, '$2')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/==(.*?)==/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\s*\|\s*/g, (m) => (m.includes('|') ? ' · ' : m))
      .replace(/[ \t]+/g, ' ')
      .trim()
    if (text) lines.push(text)
  }
  return lines.join('\n')
}

/** The first `length` characters of `text`, ended at a word, with an ellipsis when it was cut. */
export function excerptOf(text: string, length = EXCERPT_LENGTH): string {
  if (text.length <= length) return text
  const cut = text.slice(0, length + 1)
  const at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'))
  return (at > length / 2 ? cut.slice(0, at) : cut.slice(0, length)).trimEnd() + '…'
}

/** The first image embed in the body, as the name the note links it by. */
export function firstImageLink(body: string): string | null {
  const embeds = body.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|!\[[^\]]*\]\(([^)\s]+)\)/g)
  for (const m of embeds) {
    const target = (m[1] ?? m[2] ?? '').trim()
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
    const ext = target.split('.').pop()?.toLowerCase() ?? ''
    if (IMAGE_EXTENSIONS.includes(ext)) return target
  }
  return null
}

function tagsOf(
  frontmatter: Record<string, unknown>,
  cacheTags: Array<{ tag: string }> | undefined
): string[] {
  const out = new Set<string>()
  const fm = frontmatter.tags ?? frontmatter.tag
  const declared = Array.isArray(fm) ? fm : typeof fm === 'string' ? fm.split(/[,\s]+/) : []
  for (const t of declared)
    if (typeof t === 'string' && t.trim()) out.add(t.trim().replace(/^#/, ''))
  for (const { tag } of cacheTags ?? []) out.add(tag.replace(/^#/, ''))
  return [...out]
}

/** A `cover` written as `[[x]]`, `![[x]]` or a path, as the file it names. */
function coverOf(frontmatter: Record<string, unknown>, body: string, path: string): string | null {
  const declared = frontmatter.cover
  const candidates: string[] = []
  if (typeof declared === 'string' && declared.trim()) {
    candidates.push(declared.trim().replace(/^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/, '$1'))
  }
  const embedded = firstImageLink(body)
  if (embedded) candidates.push(embedded)
  for (const candidate of candidates) {
    const file = resolveVaultFile(candidate, path)
    if (file) return file.path
  }
  return null
}

export async function noteInfo(path: string): Promise<NoteInfo> {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) throw new Error(`Note not found: ${path}`)

  const raw = await app.vault.cachedRead(file)
  const cache = app.metadataCache.getFileCache(file)
  const { position: _position, ...frontmatter } = (cache?.frontmatter ?? {}) as Record<
    string,
    unknown
  >
  const body = stripFrontmatter(raw)
  const text = plainText(body)
  const title =
    typeof frontmatter.title === 'string' && frontmatter.title.trim()
      ? frontmatter.title.trim()
      : file.basename

  return {
    path: file.path,
    name: file.basename,
    folder: file.parent?.path === '/' ? '' : (file.parent?.path ?? ''),
    title,
    frontmatter,
    tags: tagsOf(frontmatter, cache?.tags),
    created: new Date(file.stat.ctime).toISOString(),
    modified: new Date(file.stat.mtime).toISOString(),
    cover: coverOf(frontmatter, body, file.path),
    body,
    text,
    excerpt: excerptOf(text),
    words: text ? text.split(/\s+/).length : 0,
  }
}
