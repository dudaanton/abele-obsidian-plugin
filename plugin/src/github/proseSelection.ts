/**
 * Text selected in a GitHub tab's prose — a description, a comment, a reply, a review comment, a
 * commit message, a rendered file — and what it is part of, so it can be asked about, linked or
 * quoted into a note, and so `github_views` can tell an agent what the person is pointing at.
 *
 * Each comment registers the element it draws with how to link to it; a selection is attributed
 * to the innermost registered element around each of its ends. Both ends in one comment: that
 * comment, by its anchor. Otherwise — across comments, or in text that is no comment — the item.
 * Code is left out: its lines have their own selection, by their numbers.
 */
import type { GithubLink } from './permalinks'
import type { ProseQuote } from './chatAbout'
import { commentSnippet, type SnippetBlock } from './snippetBlock'

/** What a registered piece of prose is: where a link to it goes, and who wrote it. */
export interface ProseSource {
  /** A link to it — a comment by its anchor, a description as the item; null before it loads. */
  link(): GithubLink | null
  /** "comment", "reply", "review comment", "issue" for a description. */
  what: string
  /** The login. */
  author?: string
  /** The author as the agent is told: with the name from their profile when it is known. */
  by?: string
  createdAt?: string
  /** The `#…` GitHub gives it; none for a description. */
  anchor?: string
  /** What it is called where "the comment by bob" does not fit: "the README". */
  name?: string
  /** Its own text, apart from its replies: the part a selection across comments is looked for in. */
  body?: () => Element | null
}

/** A selection of prose, as a tab keeps it and `github_views` reports it. Plain data only. */
export interface ProseSelection {
  /** The selected text, as the page gives it. */
  text: string
  /** Where it is linked to: the comment, or the item when it is not inside one. */
  link: GithubLink
  /** "the reply by ann", "the discussion's description", "the page". */
  where: string
  author?: string
  createdAt?: string
  anchor?: string
  /** The comments it runs across, when more than one: "the comment by bob". */
  spans?: string[]
}

const sources = new WeakMap<Element, ProseSource>()

export function registerProse(el: Element, source: ProseSource): void {
  sources.set(el, source)
}

export function unregisterProse(el: Element): void {
  sources.delete(el)
}

/** Where a selection is not prose: code has its own selection, a field its own text. */
const NOT_PROSE = '.cm-editor, input, textarea, [contenteditable="true"], [data-prose-skip]'

const elementOf = (node: Node): Element | null =>
  node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement

/** The innermost registered element around `node`, below `root`. */
function sourceAround(node: Node, root: Element): { el: Element; source: ProseSource } | null {
  for (let el = elementOf(node); el && el !== root; el = el.parentElement) {
    const source = sources.get(el)
    if (source) return { el, source }
  }
  return null
}

/** "the reply by ann", for a description "the pull request's description", else its `name`. */
export function describeSource(source: ProseSource): string {
  if (source.name) return source.name
  if (!source.anchor) return `the ${source.what}'s description`
  const by = source.by ?? source.author
  return by ? `the ${source.what} by ${by}` : `the ${source.what}`
}

/** A selection's text tidied for quoting: no run of blank lines, no space at either end. */
export function tidySelected(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * What `range` selects in `root`'s prose, or null for nothing, for code, for a field, or for a
 * range that is not in `root` at all.
 *
 * @param item a link to the item on screen, for text in no comment or across several
 * @param page what text in no comment is called: "the commit message", "the file"
 */
export function readProse(
  root: Element,
  range: Range,
  text: string,
  item: GithubLink | null,
  page = 'the page'
): ProseSelection | null {
  const quoted = tidySelected(text)
  if (!quoted || range.collapsed) return null
  const start = range.startContainer
  const end = range.endContainer
  if (!root.contains(start) || !root.contains(end)) return null
  if ([start, end].some((n) => elementOf(n)?.closest(NOT_PROSE))) return null

  const single = (source: ProseSource): ProseSelection | null => {
    const link = source.link()
    if (!link) return null
    const { author, createdAt, anchor } = source
    return { text: quoted, link, where: describeSource(source), author, createdAt, anchor }
  }

  const atItem = (where: string): ProseSelection | null =>
    item ? { text: quoted, link: item, where } : null

  const from = sourceAround(start, root)
  const to = sourceAround(end, root)
  if (from && to && from.el === to.el) return single(from.source) ?? atItem(page)

  // The comments whose own text the selection runs through, replies apart from their parent.
  const touched: ProseSource[] = []
  root.querySelectorAll('*').forEach((el) => {
    const source = sources.get(el)
    if (source && range.intersectsNode(source.body?.() ?? el)) touched.push(source)
  })
  if (touched.length === 1) return single(touched[0]) ?? atItem(page)
  const across = touched.length > 1 ? atItem('several comments') : null
  return across ? { ...across, spans: touched.map(describeSource) } : atItem(page)
}

/** "the comment by bob and the reply by ann", "a, b and c". */
export function listOf(parts: string[]): string {
  if (parts.length < 2) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** What "Ask here" quotes in the chat: the text, and which comments it runs across. */
export function proseQuote(p: ProseSelection): ProseQuote {
  return p.spans ? { text: p.text, note: `Across ${listOf(p.spans)}:` } : { text: p.text }
}

/** The selection as a quote card for the note: who wrote it and when, when that is one person. */
export function proseSnippet(p: ProseSelection): SnippetBlock {
  if (p.author)
    return commentSnippet(p.link, { author: p.author, createdAt: p.createdAt, body: p.text })
  return { ...p.link, kind: 'comment', text: p.text }
}
