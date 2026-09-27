/**
 * A picture embedded in a note, pointed at a new picture: which embed in the note a picture was
 * opened from, and the note's text with that one embed, and nothing else, changed.
 *
 * Pure: the note's text and its embeds come in, text goes out.
 */

/** Where in a note the embed a drawing was opened from stands, and how it was written. */
export interface EmbedAnchor {
  /** The note the embed is in. */
  note: string
  /** Where the embed begins in the note's text. */
  start: number
  /** The embed as written, `![[cat.png|300]]` or `![cat](cat.png)`. */
  original: string
}

/** An embed as Obsidian's metadata cache lists it. */
export interface CachedEmbed {
  original: string
  link: string
  position: { start: { line: number; offset: number }; end: { line: number; offset: number } }
}

/**
 * What tells one embed of a picture from another: a place in the text (the live preview's
 * editor knows it exactly), or the lines of the rendered block and which of the picture's embeds
 * in that block it is (reading view knows only as much).
 */
export type EmbedHint =
  | { at: number }
  | { lineStart: number; lineEnd: number; index: number }
  | null

/**
 * The embed of the picture the hint points at, among a note's embeds; `isPicture` says which of
 * them show the picture. Without a hint, the picture's only embed in the note, if it has one.
 */
export function pickEmbed(
  embeds: readonly CachedEmbed[],
  isPicture: (link: string) => boolean,
  hint: EmbedHint
): CachedEmbed | null {
  const ours = embeds.filter((e) => isPicture(e.link))
  if (!hint) return ours.length === 1 ? ours[0] : null
  if ('at' in hint) {
    return (
      ours.find((e) => e.position.start.offset <= hint.at && hint.at <= e.position.end.offset) ??
      null
    )
  }
  const inBlock = ours.filter(
    (e) => e.position.start.line >= hint.lineStart && e.position.end.line <= hint.lineEnd
  )
  return inBlock[hint.index] ?? null
}

/**
 * The note's text with the embed the anchor names pointed at `replacement`, and where it now
 * begins. The embed is looked
 * for where it was; if the note has changed since, it is taken only if its text appears exactly
 * once — anything else is not guessed at, and the text comes back unchanged.
 */
export function replaceEmbed(
  text: string,
  anchor: EmbedAnchor,
  replacement: string
): { text: string; replaced: boolean; at: number } {
  const { start, original } = anchor
  let at = text.startsWith(original, start) ? start : -1
  if (at < 0) {
    const first = text.indexOf(original)
    const again = first < 0 ? -1 : text.indexOf(original, first + 1)
    if (first >= 0 && again < 0) at = first
  }
  if (at < 0) return { text, replaced: false, at }
  return {
    text: text.slice(0, at) + replacement + text.slice(at + original.length),
    replaced: true,
    at,
  }
}

const WIKI = /^!\[\[([^\]|#^]*)([#^][^\]|]*)?(\|[^\]]*)?\]\]$/
const MARKDOWN = /^!\[([^\]]*)\]\((<[^>]*>|[^\s)]*)(\s+"[^"]*")?\)$/

/**
 * The embed as it was written — a wikilink or a Markdown link, its size or caption, its title —
 * pointing at the picture `generated` links to. `generated` is Obsidian's own link to the new
 * picture (`fileManager.generateMarkdownLink`), so the path in it is written the way the user's
 * link settings say; only its path is taken.
 */
export function relink(original: string, generated: string): string {
  const target = linkTarget(generated)
  const wiki = WIKI.exec(original)
  if (wiki) return `![[${target.path}${wiki[2] ?? ''}${wiki[3] ?? ''}]]`
  const md = MARKDOWN.exec(original)
  if (md) {
    const url = md[2].startsWith('<')
      ? `<${target.path}>`
      : (target.url ?? encodeLinkPath(target.path))
    return `![${md[1]}](${url}${md[3] ?? ''})`
  }
  // Not a form known here: Obsidian's own link, as an embed.
  return generated.startsWith('!') ? generated : `!${generated}`
}

/** The path a link points at, and, for a Markdown link, the address as it was written. */
function linkTarget(link: string): { path: string; url?: string } {
  const wiki = /^!?\[\[([^\]|]*)(\|[^\]]*)?\]\]$/.exec(link)
  if (wiki) return { path: wiki[1] }
  const md = /^!?\[[^\]]*\]\((<[^>]*>|[^\s)]*)(\s+"[^"]*")?\)$/.exec(link)
  if (md) {
    const url = md[1]
    if (url.startsWith('<')) return { path: url.slice(1, -1) }
    let path = url
    try {
      path = decodeURI(url)
    } catch {
      // A malformed escape: the address as it stands.
    }
    return { path, url }
  }
  return { path: link }
}

/** A vault path written into a Markdown link: spaces and what would end the link escaped. */
export function encodeLinkPath(path: string): string {
  return encodeURI(path).replace(/#/g, '%23').replace(/\(/g, '%28').replace(/\)/g, '%29')
}
