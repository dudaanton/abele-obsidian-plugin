/**
 * `vocabulary` in a script's scope: vocabulary rules kept in a note's properties
 * (`src/reader/vocab/rules.ts`), so the book reader underlines a word's forms wherever they are in
 * a book and a tap on one opens the note — what a translating script sets up in one call:
 *
 * ```js
 * await vocabulary.mark({ note: card, forms: ['māja', 'mājas', 'mājā'] })
 * ```
 *
 * Run on words in a book, the rule is for that book and its language unless told otherwise. The
 * forms and books are added to what the note has, each once, so the same call twice changes
 * nothing; everything else in the note is left as it is.
 *
 * The forms can go on a highlight instead (`highlights.ts`), a tap leading to its entry in the
 * highlights note — terms kept as highlights in one shared note:
 *
 * ```js
 * await vocabulary.mark({ highlight: book, forms: ['māja', 'mājas'] })
 * ```
 *
 * `highlight: book` is the words the script was run on, highlighted first when they are not yet;
 * a link to a highlight's place names one that is.
 */
import { TFile, getFrontMatterInfo, normalizePath, parseYaml } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { linkToPlace, parsePlaceSubpath } from '@/reader/bookLinks'
import { loadBookText } from '@/reader/bookText'
import { noteFor, readHighlights, type NotesPlace } from '@/reader/companion'
import { HIGHLIGHT_COLORS, type HighlightColor } from '@/reader/highlights'
import { notesPlaceOf, setHighlightForms } from '@/reader/vocab/highlightForms'
import { linkText } from '@/reader/vocab/rules'
import { WORD_FORMS, markInto, noteRuleOf, switchInto, type RuleScope } from '@/reader/vocab/rules'
import type { BookScriptContext } from './bookContext'

/** A note's rule, as a script is given it. */
export interface ScriptVocabRule {
  note: string
  forms: string[]
  language: string
  /** The books it applies to, as the note links them. */
  books: string[]
  scope: RuleScope
  on: boolean
}

/** A highlight's forms, as a script is given them. */
export interface ScriptHighlightForms {
  /** A link to the highlight's place: what names it again. */
  highlight: string
  book: string
  /** Its words. */
  text: string
  forms: string[]
  /** The highlights note it is in. */
  note: string | null
}

/** A highlight, as a script names it: the words it was run on (`book`), or a link to its place. */
export type HighlightRef = BookScriptContext | string

/** What is marked: a note, or a highlight. */
export type MarkTarget = { note: string } | { highlight: HighlightRef }

export interface MarkHighlight {
  highlight: HighlightRef
  forms: string[] | string
  /** The colour a highlight made for this is (yellow by default); one there already keeps its own. */
  color?: HighlightColor
  replace?: boolean
}

export interface MarkWords {
  /** The note the rule goes in — and a tap on the words opens. It must exist. */
  note: string
  /** The word's forms: an array, or one string of them separated by commas. */
  forms: string[] | string
  /** Its language, `lv`: the book's by default. */
  language?: string
  /** The books it applies to, by path: the book the script was run on by default. */
  books?: string[]
  /** `book` (the books listed, the default) or `language` (every book in the language). */
  scope?: RuleScope
  /** The forms given take the place of the note's, instead of being added to them. */
  replace?: boolean
}

function noteFile(path: string): TFile {
  const { app } = GlobalStore.getInstance()
  const clean = normalizePath(path)
  const file =
    app.vault.getAbstractFileByPath(clean) ??
    (clean.endsWith('.md') ? null : app.vault.getAbstractFileByPath(`${clean}.md`))
  if (!(file instanceof TFile) || file.extension !== 'md')
    throw new Error(`vocabulary: no note at ${path}`)
  return file
}

/** The rule properties hold, as a script is given it. */
function ruleOf(
  path: string,
  fm: Record<string, unknown> | null | undefined
): ScriptVocabRule | null {
  const rule = noteRuleOf(fm)
  return rule
    ? {
        note: path,
        forms: rule.forms,
        language: rule.language,
        books: rule.books,
        scope: rule.scope,
        on: rule.on,
      }
    : null
}

/**
 * A note's properties as its file has them now — not Obsidian's reading of them, which catches up
 * a moment after a write, so a call right after `mark` would see the note before it.
 */
async function propsOf(file: TFile): Promise<Record<string, unknown>> {
  const text = await GlobalStore.getInstance().app.vault.read(file)
  const info = getFrontMatterInfo(text)
  if (!info.exists) return {}
  try {
    const parsed = parseYaml(info.frontmatter) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** The book and the place a highlight is named by, and its words when it is the script's own. */
function highlightOf(ref: unknown): {
  book: TFile
  cfi: string
  make?: { text: string; label: string }
} {
  const { app } = GlobalStore.getInstance()
  if (ref && typeof ref === 'object' && 'cfi' in ref && 'path' in ref) {
    const b = ref as BookScriptContext
    const book = app.vault.getAbstractFileByPath(b.path)
    if (!(book instanceof TFile)) throw new Error(`vocabulary: no book at ${b.path}`)
    return { book, cfi: b.cfi, make: { text: b.text, label: b.chapter } }
  }
  const text = typeof ref === 'string' ? ref.trim() : ''
  const inner = /^!?\[\[([^\]]*)\]\]$/.exec(text)?.[1] ?? text
  const target = inner.split('|')[0]
  const hash = target.indexOf('#')
  const place = hash > 0 ? parsePlaceSubpath(target.slice(hash)) : null
  if (!place || !('cfi' in place))
    throw new Error(
      'vocabulary: name a highlight by a link to a place in a book ([[Book.epub#cfi=…]]), or pass `book`'
    )
  const path = linkText(target.slice(0, hash))
  const direct = app.vault.getAbstractFileByPath(normalizePath(path))
  const book = direct instanceof TFile ? direct : app.metadataCache.getFirstLinkpathDest(path, '')
  if (!(book instanceof TFile)) throw new Error(`vocabulary: no book at ${path}`)
  return { book, cfi: place.cfi }
}

async function placeOf(book: TFile): Promise<NotesPlace> {
  return notesPlaceOf(await loadBookText(GlobalStore.getInstance().app, book))
}

/** A book as a note's property links it: a wikilink with its extension, from the note. */
function bookLink(path: string, from: string): string {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(normalizePath(path))
  const text = file instanceof TFile ? app.metadataCache.fileToLinktext(file, from, false) : path
  return `[[${text}]]`
}

export function scriptVocabulary(opts: {
  book?: BookScriptContext
  signal?: AbortSignal
  /** Told a note is about to be written, before it is. */
  wrote: (path: string) => void
}) {
  /**
   * Changes a note's properties, and writes them only when something did change. Returns them as
   * they are after it: Obsidian's own reading of the note catches up a moment later.
   */
  const change = async (
    file: TFile,
    fn: (fm: Record<string, unknown>) => void
  ): Promise<Record<string, unknown>> => {
    const { app } = GlobalStore.getInstance()
    const now = await propsOf(file)
    const before = JSON.stringify(now)
    fn(now)
    if (JSON.stringify(now) === before) return now
    opts.wrote(file.path)
    let after = now
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      opts.signal?.throwIfAborted()
      fn(fm)
      after = structuredClone(fm)
    })
    return after
  }

  /** Sets a highlight's forms — `replace` or added — and says what it holds after. */
  const markHighlight = async (
    ref: unknown,
    forms: unknown,
    replace: boolean,
    color?: unknown
  ): Promise<ScriptHighlightForms> => {
    const { app } = GlobalStore.getInstance()
    const { book, cfi, make } = highlightOf(ref)
    if (color !== undefined && !(HIGHLIGHT_COLORS as readonly unknown[]).includes(color))
      throw new Error(`vocabulary: the colours are ${HIGHLIGHT_COLORS.join(', ')}`)
    const done = await setHighlightForms(app, book, await placeOf(book), cfi, forms, {
      replace,
      make: make && { ...make, color: color as HighlightColor | undefined },
      wrote: opts.wrote,
      signal: opts.signal,
    })
    return {
      highlight: linkToPlace(app, book, { cfi }, done.highlight.label),
      book: book.path,
      text: done.highlight.text,
      forms: done.highlight.forms ?? [],
      note: done.note?.path ?? null,
    }
  }

  /** The note a call names, whichever way it names it. */
  const noteOf = (target: unknown): string => {
    if (typeof target === 'string') return target
    if (target && typeof target === 'object' && 'note' in target) return String(target.note)
    throw new Error('vocabulary: name a note, or { highlight }')
  }
  const isHighlight = (target: unknown): target is { highlight: unknown } =>
    !!target && typeof target === 'object' && 'highlight' in target

  return {
    /**
     * Keeps a rule in a note: its word's forms underlined in the book, a tap opening the note.
     * Returns the rule as the note has it now.
     */
    async mark(
      args: MarkWords | MarkHighlight
    ): Promise<ScriptVocabRule | ScriptHighlightForms | null> {
      if (isHighlight(args))
        return markHighlight(args.highlight, args.forms, !!args.replace, args.color)
      if (!args || typeof args.note !== 'string')
        throw new Error('vocabulary.mark: note is required')
      const file = noteFile(args.note)
      const forms = Array.isArray(args.forms) ? args.forms : [args.forms ?? '']
      const books = (args.books ?? (opts.book ? [opts.book.path] : [])).map((p) =>
        bookLink(p, file.path)
      )
      const language = args.language ?? opts.book?.language ?? ''
      if (args.scope === 'language' && !language)
        throw new Error('vocabulary.mark: a rule for a whole language needs its language')
      const after = await change(file, (fm) =>
        markInto(fm, { forms, books, language, scope: args.scope, replace: args.replace })
      )
      return ruleOf(file.path, after)
    },

    /** The rule a note keeps; null when it names no forms. */
    async get(target: string | MarkTarget): Promise<ScriptVocabRule | ScriptHighlightForms | null> {
      if (isHighlight(target)) {
        const { app } = GlobalStore.getInstance()
        const { book, cfi } = highlightOf(target.highlight)
        const place = await placeOf(book)
        const h = (await readHighlights(app, book, place)).find((x) => x.cfi === cfi)
        if (!h) return null
        return {
          highlight: linkToPlace(app, book, { cfi }, h.label),
          book: book.path,
          text: h.text,
          forms: h.forms ?? [],
          note: (await noteFor(app, book, place, cfi))?.path ?? null,
        }
      }
      const file = noteFile(noteOf(target))
      return ruleOf(file.path, await propsOf(file))
    },

    /** The note's words no longer underlined; its forms kept. */
    async off(target: string | MarkTarget): Promise<void> {
      // A highlight's words are underlined while it has forms: off takes them away.
      if (isHighlight(target)) {
        await markHighlight(target.highlight, [], true)
        return
      }
      await change(noteFile(noteOf(target)), (fm) => {
        if (fm[WORD_FORMS] !== undefined) switchInto(fm, false)
      })
    },

    /** The note's words underlined again. */
    async on(target: string | MarkTarget): Promise<void> {
      if (isHighlight(target))
        throw new Error(
          'vocabulary.on: a highlight is underlined while it has forms; give it some with mark'
        )
      await change(noteFile(noteOf(target)), (fm) => switchInto(fm, true))
    },
  }
}
