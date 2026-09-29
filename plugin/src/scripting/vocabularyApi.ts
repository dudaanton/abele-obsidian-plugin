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
 */
import { TFile, getFrontMatterInfo, normalizePath, parseYaml } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
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

/** A book as a note's property links it: a wikilink with its extension, from the note. */
function bookLink(path: string, from: string): string {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(normalizePath(path))
  const text = file instanceof TFile ? app.metadataCache.fileToLinktext(file, from, false) : path
  return `[[${text}]]`
}

export function scriptVocabulary(opts: {
  book?: BookScriptContext
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
      fn(fm)
      after = structuredClone(fm)
    })
    return after
  }

  return {
    /**
     * Keeps a rule in a note: its word's forms underlined in the book, a tap opening the note.
     * Returns the rule as the note has it now.
     */
    async mark(args: MarkWords): Promise<ScriptVocabRule | null> {
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
    async get(note: string): Promise<ScriptVocabRule | null> {
      const file = noteFile(note)
      return ruleOf(file.path, await propsOf(file))
    },

    /** The note's words no longer underlined; its forms kept. */
    async off(note: string): Promise<void> {
      await change(noteFile(note), (fm) => {
        if (fm[WORD_FORMS] !== undefined) switchInto(fm, false)
      })
    },

    /** The note's words underlined again. */
    async on(note: string): Promise<void> {
      await change(noteFile(note), (fm) => switchInto(fm, true))
    },
  }
}
