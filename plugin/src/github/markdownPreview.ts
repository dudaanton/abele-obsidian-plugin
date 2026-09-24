/**
 * The rendered view of a markdown file from GitHub: which mode a tab opens in, which source lines
 * a rendered block stands for, how picking blocks becomes a selection of lines, and the text each
 * block is handed to the renderer as.
 *
 * Everything here is plain data, so the component that draws it stays small and this can be
 * tested line by line.
 */
import type { LineSpan } from './permalinks'
import type { LineRange } from './urls'
import type { MdBlock } from './markdownBlocks'

/** Files GitHub renders as markdown. MDX is markdown with components, which render as HTML. */
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdx'])

export function isMarkdownPath(path: string): boolean {
  const name = path.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 && MARKDOWN_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}

export type BlobMode = 'preview' | 'code'

/**
 * How a file opens. Only markdown has a preview, and it opens in it — unless the link names lines
 * (`#L10-L20`) or asks for the source (`?plain=1`), which GitHub shows as code too. What the tab
 * was last switched to wins over both: that is how back, forward and a restart keep it.
 */
export function blobMode(o: {
  path: string
  lines?: LineRange
  plain?: boolean
  stored?: BlobMode
}): BlobMode {
  if (!isMarkdownPath(o.path)) return 'code'
  if (o.stored) return o.stored
  return o.lines || o.plain ? 'code' : 'preview'
}

/** The block holding `line`; for a line between blocks, the next one; -1 for none. */
export function blockAt(blocks: MdBlock[], line: number): number {
  const i = blocks.findIndex((b) => b.end >= line)
  if (i >= 0) return i
  return blocks.length ? blocks.length - 1 : -1
}

/** Every block with a line in `span`. */
export function blocksOverlapping(blocks: MdBlock[], span: LineSpan | null | undefined): number[] {
  if (!span) return []
  const out: number[] = []
  blocks.forEach((b, i) => {
    if (b.start <= span.to && b.end >= span.from) out.push(i)
  })
  return out
}

export interface Picked {
  selected: LineSpan | null
  /** The block a Shift-click extends from. */
  anchor: number | null
}

/**
 * A click on a block's handle: selects its lines; with Shift, everything from the block picked
 * before to this one; on the only block selected, clears the selection — the way a line number
 * behaves in the code view.
 */
export function pickBlock(
  blocks: MdBlock[],
  current: Picked,
  index: number,
  shift: boolean
): Picked {
  const block = blocks[index]
  if (!block) return current
  if (shift && current.anchor !== null && blocks[current.anchor]) {
    const a = blocks[current.anchor]
    return {
      selected: { from: Math.min(a.start, block.start), to: Math.max(a.end, block.end) },
      anchor: current.anchor,
    }
  }
  const s = current.selected
  if (s && s.from === block.start && s.to === block.end) return { selected: null, anchor: null }
  return { selected: { from: block.start, to: block.end }, anchor: index }
}

/** Fence languages drawn as code. Anything else a plugin may claim as a block of its own. */
const PLAIN_LANGUAGES = new Set(
  (
    'text txt plain plaintext md markdown mdx diff patch sh bash zsh shell console shellsession ' +
    'powershell ps1 bat cmd fish js javascript mjs cjs jsx ts typescript tsx json json5 jsonc ' +
    'yaml yml toml ini cfg conf properties env dotenv xml html htm svg css scss sass less vue ' +
    'svelte astro py python ipython rb ruby go golang rs rust java kotlin kt kts scala groovy ' +
    'gradle swift objc objectivec c h cpp cc cxx hpp cs csharp fs fsharp php pl perl lua r ' +
    'dart elixir ex exs erlang erl haskell hs clojure clj elm ocaml ml nim zig julia sql graphql ' +
    'gql proto protobuf dockerfile docker makefile make cmake nginx apache http hcl terraform tf ' +
    'nix vim tex latex bibtex matlab regex csv tsv log mermaid math asciidoc rst'
  ).split(' ')
)

const FENCE_LINE = /^([ \t>]*?)(`{3,}|~{3,})[ \t]*([^\s`]*)(.*)$/

/**
 * Fenced blocks with a language nothing but a plugin knows are shown as plain text: a README
 * with a ```dataviewjs block, rendered here as it is, would run that plugin's code in the vault.
 * Only opening fences are touched — the text inside a block is never changed.
 */
export function neutraliseFences(text: string): string {
  const lines = text.split('\n')
  let open: { char: string; length: number } | null = null
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_LINE.exec(lines[i])
    if (!m) continue
    const [, prefix, fence, lang, rest] = m
    if (open) {
      if (fence[0] === open.char && fence.length >= open.length && !lang && !rest.trim())
        open = null
      continue
    }
    if (fence[0] === '`' && rest.includes('`')) continue
    open = { char: fence[0], length: fence.length }
    if (lang && !PLAIN_LANGUAGES.has(lang.toLowerCase())) {
      lines[i] = `${prefix}${fence}text${rest}`
    }
  }
  return lines.join('\n')
}

const FOOTNOTE_REF = /\[\^([^\]\s]+)\](?!:)/g

/** Footnote labels as a block's text refers to them, in order, each once. */
export function footnoteRefs(text: string): string[] {
  return [...new Set([...text.matchAll(FOOTNOTE_REF)].map((m) => m[1]))]
}

export interface Sources {
  /** The source lines of the file. */
  lines: string[]
  /** Every link reference definition, so `[text][ref]` resolves in whichever block uses it. */
  definitions: string
  /** Each footnote's definition text, by label. */
  footnotes: Map<string, string>
  /** The number GitHub gives each footnote: by first reference in the file. */
  footnoteNumbers: Map<string, number>
}

export function sourcesOf(text: string, blocks: MdBlock[]): Sources {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const of = (b: MdBlock) => lines.slice(b.start - 1, b.end).join('\n')
  const definitions = blocks
    .filter((b) => b.kind === 'definitions')
    .map(of)
    .join('\n')
  const footnotes = new Map<string, string>()
  for (const b of blocks) if (b.kind === 'footnote' && b.footnote) footnotes.set(b.footnote, of(b))
  const footnoteNumbers = new Map<string, number>()
  for (const b of blocks) {
    if (b.kind === 'footnote' || b.kind === 'code') continue
    for (const label of footnoteRefs(of(b)))
      if (footnotes.has(label) && !footnoteNumbers.has(label))
        footnoteNumbers.set(label, footnoteNumbers.size + 1)
  }
  return { lines, definitions, footnotes, footnoteNumbers }
}

/**
 * What a block is rendered from: its own lines, adjusted so that alone it renders as it would in
 * the whole file.
 *
 * - Front matter becomes a YAML code block, the way GitHub shows it as a table of its own.
 * - An ordered list item carries its number in the list.
 * - Reference-style links and footnotes find their definitions, which are appended; a footnote
 *   list rendered from them is removed again after rendering, by the caller.
 * - A footnote's definition is rendered behind a reference to it: alone, the renderer drops a
 *   definition nothing refers to. The caller keeps the footnote list and drops the reference.
 * - Fences in a language a plugin might claim are shown as plain text.
 */
export function blockSource(block: MdBlock, sources: Sources): string {
  const lines = sources.lines.slice(block.start - 1, block.end)
  if (block.kind === 'frontmatter') {
    return ['```yaml', ...lines.slice(1, -1), '```'].join('\n')
  }
  if (block.kind === 'definitions') return ''
  if (block.kind === 'list-item' && block.list?.number !== undefined) {
    lines[0] = lines[0].replace(/^( {0,3})\d{1,9}/, `$1${block.list.number}`)
  }
  let text = neutraliseFences(lines.join('\n'))
  if (block.kind === 'code' || block.kind === 'math') return text
  if (block.kind === 'footnote' && block.footnote) text = `[^${block.footnote}]\n\n${text}`
  const extra: string[] = []
  if (sources.definitions && text.includes(']')) extra.push(sources.definitions)
  if (block.kind !== 'footnote') {
    for (const label of footnoteRefs(text)) {
      const def = sources.footnotes.get(label)
      if (def) extra.push(neutraliseFences(def))
    }
  }
  if (extra.length) text = `${text}\n\n${extra.join('\n\n')}`
  return text
}

/** "Line 4", "Lines 4–9". */
export function linesLabel(span: LineSpan): string {
  return span.from === span.to ? `Line ${span.from}` : `Lines ${span.from}–${span.to}`
}

/**
 * Footnotes of a block rendered alone. A block that refers to a footnote was rendered with its
 * definition appended, so it arrives with a footnote list of its own: that list goes — the
 * definition is a block of the file, rendered where the file has it. Each reference is numbered
 * as GitHub numbers it in the whole file and marked with its label, for the click that scrolls to
 * the definition; a definition's list starts at its number, and its back arrow knows its label.
 */
export function finishFootnotes(el: HTMLElement, block: MdBlock, sources: Sources): void {
  const text = sources.lines.slice(block.start - 1, block.end).join('\n')
  if (block.kind === 'footnote' && block.footnote) {
    // Only the list: the reference in front of it was there to make the renderer draw it.
    const list = el.querySelector('section.footnotes, .footnotes')
    if (list) el.replaceChildren(list)
    const n = sources.footnoteNumbers.get(block.footnote)
    if (n) el.querySelector('.footnotes ol, ol')?.setAttribute('start', String(n))
    for (const back of Array.from(el.querySelectorAll('a.footnote-backref')))
      (back as HTMLElement).dataset.abeleFootnoteBack = block.footnote
    return
  }
  for (const list of Array.from(
    el.querySelectorAll('section.footnotes, .footnotes, hr.footnotes-sep')
  ))
    list.remove()
  // Rendered alone, the block numbers its footnotes 1, 2… in the order it refers to them.
  const labels = footnoteRefs(text).filter((l) => sources.footnotes.has(l))
  for (const a of Array.from(el.querySelectorAll('a.footnote-link, sup a[href^="#fn"]'))) {
    const local = Number((a.textContent ?? '').replace(/\D/g, ''))
    const label = labels[local - 1]
    if (!label) continue
    ;(a as HTMLElement).dataset.abeleFootnote = label
    const global = sources.footnoteNumbers.get(label)
    if (global) a.textContent = (a.textContent ?? '').replace(/\d+/, String(global))
  }
}
