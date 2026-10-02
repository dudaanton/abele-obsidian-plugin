/**
 * Fill the editor's language gaps with the very same Prism registry as reading view.
 * HyperMD's parsed fences are the authority: fence-looking prose and rendered blocks are
 * not code. A block with native syntax tokens is left entirely to Obsidian, not overpainted.
 */
import { StateEffect, type EditorState, type Extension, type Range } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { loadPrism, type App } from 'obsidian'

export const MAX_BLOCK_CHARACTERS = 32_768
const MAX_BLOCK_LINES = 1000
const MAX_CACHE_BLOCKS = 16
const MAX_TOKEN_SPANS = 16_384
export const refreshEditorSyntax = StateEffect.define<null>()

export interface PrismToken {
  type: string
  content: string | PrismToken | (string | PrismToken)[]
  alias?: string | string[]
}

export interface PrismEngine {
  languages: Record<string, unknown>
  tokenize(source: string, grammar: unknown): (string | PrismToken)[]
}

interface Span {
  from: number
  to: number
  classes: string
}

interface SourceLine {
  from: number
  to: number
  /** Position in Prism's container-free source. */
  offset: number
}

interface Block {
  from: number
  to: number
  language: string
  native: boolean
  lines: SourceLine[]
}

const specialLanguages = new Set([
  'mermaid',
  'dataview',
  'dataviewjs',
  'query',
  'tasks',
  'math',
  'slide',
  'script',
  'chart',
  'map',
  'drawing',
  'button',
  'buttons',
])

const isSpecial = (language: string): boolean =>
  language.startsWith('abele-') || language.startsWith('ad-') || specialLanguages.has(language)

// HyperMD currently exposes fenced blocks inside quotes as multiline inline-code instead
// of codeblock nodes. Only a parser-confirmed quote/code span can use this fallback.
const quotedCode = (name: string): boolean =>
  name.includes('inline-code') && /(?:^|_)quote(?:_|-)/.test(name)
const quoteFence = /^[ \t]*(?:>[ \t]?)+(\x60{3,}|~{3,})([^\x60~]*)$/

/** Read the parser, never look at the DOM (which may already hold our decorations). */
function lineKind(state: EditorState, number: number) {
  const line = state.doc.line(number)
  let begin = false
  let end = false
  let contentFrom = line.to
  let native = false
  let quoted = false
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      if (node.from > line.to || node.to < line.from) return false
      if (node.name.includes('codeblock-begin')) begin = true
      if (node.name.includes('codeblock-end')) end = true
      if (quotedCode(node.name)) {
        quoted = true
        contentFrom = Math.min(contentFrom, node.from)
      }
      if (
        node.name.includes('hmd-codeblock') &&
        !node.name.includes('HyperMD') &&
        !node.name.includes('formatting') &&
        !node.name.includes('codeblock-begin') &&
        !node.name.includes('codeblock-end')
      ) {
        contentFrom = Math.min(contentFrom, node.from)
        // Only syntax classes count: quote/list container classes are not native tokens.
        native ||= node.name
          .split('_')
          .some((name) =>
            /^(?:keyword|def|atom|number|string(?:-2)?|comment|operator|variable(?:-[23])?|type|builtin|tag|attribute|property|qualifier|meta|error)$/.test(
              name
            )
          )
      }
    },
  })
  const fence = quoted ? quoteFence.exec(line.text) : null
  if (fence) {
    begin ||= !!fence[2].trim()
    end ||= !fence[2].trim()
  }
  return { begin, end, contentFrom, native, quoted }
}

/** Locate only a visible block, with a hard bound in both directions for enormous fences. */
function blockAt(state: EditorState, position: number): Block | null {
  const doc = state.doc
  const visible = doc.lineAt(position)
  let opening = visible.number
  for (;;) {
    const line = doc.line(opening)
    const kind = lineKind(state, opening)
    if (kind.end && opening === visible.number) return null
    if (kind.begin) break
    if (
      (kind.end && !kind.quoted) ||
      opening === 1 ||
      visible.number - opening > MAX_BLOCK_LINES ||
      visible.from - line.from > MAX_BLOCK_CHARACTERS
    )
      return null
    opening--
  }
  const first = doc.line(opening)
  // The parser already established that this is an opening fence, including containers.
  const fence = /(`{3,}|~{3,})\s*([^\s`~]*)/.exec(first.text)
  const language = fence?.[2]?.toLowerCase()
  if (!fence || !language) return null
  const from = first.to + 1
  if (from > doc.length) return null
  let to = doc.length
  let native = false
  let offset = 0
  const lines: SourceLine[] = []
  for (let number = opening + 1; number <= doc.lines; number++) {
    const line = doc.line(number)
    if (line.from - from > MAX_BLOCK_CHARACTERS) return null
    const kind = lineKind(state, number)
    const quotedEnd = kind.quoted ? quoteFence.exec(line.text) : null
    const closes =
      kind.end &&
      (!quotedEnd || (quotedEnd[1][0] === fence[1][0] && quotedEnd[1].length >= fence[1].length))
    if (closes) {
      to = line.from
      break
    }
    if (number - opening > MAX_BLOCK_LINES) return null
    native ||= kind.native
    lines.push({ from: kind.contentFrom, to: line.to, offset })
    offset += line.to - kind.contentFrom + (number < doc.lines ? 1 : 0)
  }
  if (to - from > MAX_BLOCK_CHARACTERS || to <= from) return null
  return { from, to, language, native, lines }
}

function visibleBlocks(view: EditorView): Block[] {
  const blocks: Block[] = []
  const visited = new Set<number>()
  for (const range of view.visibleRanges) {
    let ignored = false
    syntaxTree(view.state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (
          !node.name.includes('hmd-codeblock') &&
          !node.name.includes('HyperMD-codeblock') &&
          !quotedCode(node.name)
        )
          return
        const line = view.state.doc.lineAt(node.from)
        if (visited.has(line.number)) return false
        visited.add(line.number)
        if (blocks.some((block) => node.from >= block.from && node.from < block.to)) return false
        // An enormous or unlabelled block is checked once, not once per visible line.
        const kind = lineKind(view.state, line.number)
        if (kind.begin) ignored = false
        if (ignored || kind.end) return false
        const block = blockAt(view.state, node.from)
        if (block && !blocks.some((found) => found.from === block.from)) blocks.push(block)
        if (!block) ignored = true
        return false
      },
    })
  }
  return blocks.filter((block) => !block.native && !isSpecial(block.language))
}

// These are the theme's own classes, not a second palette. Prism classes remain present for
// themes styling reading tokens globally; cm-* also works with editor-specific theme rules.
const cmClass: Record<string, string> = {
  comment: 'cm-comment',
  prolog: 'cm-comment',
  doctype: 'cm-meta',
  cdata: 'cm-comment',
  punctuation: 'cm-punctuation',
  property: 'cm-property',
  tag: 'cm-tag',
  boolean: 'cm-atom',
  number: 'cm-number',
  constant: 'cm-atom',
  symbol: 'cm-atom',
  deleted: 'cm-deleted',
  selector: 'cm-qualifier',
  'attr-name': 'cm-attribute',
  string: 'cm-string',
  char: 'cm-string',
  builtin: 'cm-builtin',
  inserted: 'cm-inserted',
  operator: 'cm-operator',
  entity: 'cm-atom',
  url: 'cm-string',
  atrule: 'cm-keyword',
  'attr-value': 'cm-string',
  keyword: 'cm-keyword',
  function: 'cm-def',
  'class-name': 'cm-type',
  regex: 'cm-string-2',
  important: 'cm-keyword',
  variable: 'cm-variable',
  namespace: 'cm-meta',
}

/** Flatten nested Prism tokens without HTML, preserving UTF-16 document offsets exactly. */
function tokenSpans(tokens: (string | PrismToken)[]): Span[] {
  const spans: Span[] = []
  let offset = 0
  const walk = (
    value: string | PrismToken | (string | PrismToken)[],
    classes: string[],
    depth: number
  ): void => {
    if (typeof value === 'string') {
      if (value.length && classes.length) {
        if (spans.length >= MAX_TOKEN_SPANS) throw new Error('Token span limit')
        const names = [...new Set(classes)].filter((name) => /^[\w-]+$/.test(name))
        spans.push({
          from: offset,
          to: offset + value.length,
          classes: [
            'abele-syntax-token',
            'token',
            ...names,
            ...names.map((name) => cmClass[name]).filter(Boolean),
          ].join(' '),
        })
      }
      offset += value.length
    } else if (Array.isArray(value)) {
      for (const child of value) walk(child, classes, depth)
    } else {
      if (depth >= 32) throw new Error('Token nesting limit')
      walk(value.content, [...classes, value.type, ...[value.alias ?? []].flat()], depth + 1)
    }
  }
  walk(tokens, [], 0)
  return spans
}

/** One cache per view, at most half a megabyte of source, and no bundled Prism or grammars. */
export function editorSyntaxExtension(
  enabled: () => boolean,
  load: () => Promise<PrismEngine> = loadPrism
): Extension {
  let loading: Promise<PrismEngine> | undefined
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none
      private prism?: PrismEngine
      private destroyed = false
      private requested = false
      private cache = new Map<string, Span[]>()

      constructor(private view: EditorView) {
        this.compute()
      }

      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.viewportChanged ||
          syntaxTree(update.state) !== syntaxTree(update.startState) ||
          update.transactions.some((tr) =>
            tr.effects.some((effect) => effect.is(refreshEditorSyntax))
          )
        ) {
          this.compute()
        }
      }

      private compute(): void {
        this.decorations = Decoration.none
        if (!enabled()) {
          this.cache.clear()
          return
        }
        const blocks = visibleBlocks(this.view)
        if (!blocks.length) return
        if (!this.prism) {
          if (!this.requested) {
            this.requested = true
            loading ??= Promise.resolve().then(load)
            void loading
              .then((prism) => {
                if (this.destroyed) return
                this.prism = prism
                this.view.dispatch({ effects: refreshEditorSyntax.of(null) })
              })
              .catch(() => {
                /* Loading failure leaves Obsidian's editor intact. */
              })
          }
          return
        }
        const marks: Range<Decoration>[] = []
        for (const block of blocks) {
          if (!Object.hasOwn(this.prism.languages, block.language)) continue
          const grammar = this.prism.languages[block.language]
          if (!grammar || typeof grammar !== 'object') continue
          const source = block.lines
            .map(
              (line) =>
                this.view.state.doc.sliceString(line.from, line.to) +
                (line.to < this.view.state.doc.length ? '\n' : '')
            )
            .join('')
          const key = `${block.language}\n${source}`
          let spans = this.cache.get(key)
          if (!spans) {
            try {
              spans = tokenSpans(this.prism.tokenize(source, grammar))
            } catch {
              spans = []
            } // A grammar failure must not break typing or the view plugin.
          }
          this.cache.delete(key)
          this.cache.set(key, spans)
          if (this.cache.size > MAX_CACHE_BLOCKS) {
            const oldest = this.cache.keys().next().value
            if (oldest !== undefined) this.cache.delete(oldest)
          }
          // Container markers are not source. Clip tokens to actual code on each visible
          // line; a multiline string/comment keeps its context but never paints the '> '.
          let spanIndex = 0
          for (const line of block.lines) {
            if (
              !this.view.visibleRanges.some(
                (range) => line.from <= range.to && line.to >= range.from
              )
            )
              continue
            while (spanIndex < spans.length && spans[spanIndex].to <= line.offset) spanIndex++
            for (let index = spanIndex; index < spans.length; index++) {
              const span = spans[index]
              if (span.from >= line.offset + line.to - line.from) break
              for (const visible of this.view.visibleRanges) {
                const from = Math.max(line.from + span.from - line.offset, line.from, visible.from)
                const to = Math.min(line.from + span.to - line.offset, line.to, visible.to)
                if (from < to) marks.push(Decoration.mark({ class: span.classes }).range(from, to))
              }
            }
          }
        }
        this.decorations = Decoration.set(marks, true)
      }

      destroy(): void {
        this.destroyed = true
        this.cache.clear()
      }
    },
    { decorations: (plugin) => plugin.decorations }
  )
}

/** Setting changes, including a settings transfer, take effect in editors already open. */
export function refreshSyntaxEditors(app: App): void {
  app.workspace.iterateAllLeaves((leaf) => {
    const editor = (leaf.view as { editor?: { cm?: EditorView } }).editor
    editor?.cm?.dispatch({ effects: refreshEditorSyntax.of(null) })
  })
}
