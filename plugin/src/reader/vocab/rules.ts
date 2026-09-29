/**
 * Vocabulary rules: "underline these forms of a word in this book, and lead to here". A rule lives
 * in one of two places.
 *
 * - **A note's properties** — a card with a word's translation, say. The note is where a tap on
 *   the word leads:
 *
 *   ```yaml
 *   word-forms: [māja, mājas, mājā]
 *   word-language: lv
 *   word-books: ["[[Books/Novel.epub]]"]
 *   word-scope: book          # or `language`: every book in word-language
 *   word-underline: false     # turned off, the forms kept
 *   ```
 *
 * - **A highlight** whose entry holds forms (`{{ forms }}` in the highlights template, or a
 *   `forms::` line in its callout — `highlights.ts`). A tap leads to that entry in its note. It
 *   applies to the highlight's own book.
 *
 * Everything here works on plain values, so the rules are tested without a vault.
 */
import type { Highlight } from '../highlights'
import { formKey, parseForms } from './words'

/** The properties a rule is kept in on a note. */
export const WORD_FORMS = 'word-forms'
export const WORD_LANGUAGE = 'word-language'
export const WORD_BOOKS = 'word-books'
export const WORD_SCOPE = 'word-scope'
export const WORD_UNDERLINE = 'word-underline'

export type RuleScope = 'book' | 'language'

/** A rule as a note's properties hold it. */
export interface NoteRule {
  forms: string[]
  language: string
  /** The books it applies to, as their links are written: a path or a link text. */
  books: string[]
  scope: RuleScope
  on: boolean
}

/** Where a tap on a word a rule underlines leads. */
export type RuleTarget = { kind: 'note'; path: string } | { kind: 'highlight'; cfi: string }

/** A rule that applies to the open book. */
export interface VocabRule {
  /** Tells rules apart: `note:<path>` or `highlight:<cfi>`. */
  id: string
  forms: string[]
  /** The forms as compared (`wordKey`), each once; a form of several words has none. */
  keys: string[]
  /** What the rule is called in a menu of several: the note's name, the highlight's words. */
  label: string
  target: RuleTarget
}

const OFF = new Set(['false', 'no', 'off', '0'])

/** Whether a property's value turns a rule off. */
const isOff = (value: unknown): boolean =>
  value === false ||
  value === 0 ||
  (typeof value === 'string' && OFF.has(value.trim().toLowerCase()))

/** A link as written in a property — `[[Books/X.epub|X]]`, `Books/X.epub` — as its link text. */
export function linkText(value: string): string {
  const inner = /^\s*!?\[\[([^\]]*)\]\]\s*$/.exec(value)?.[1] ?? value
  const md = /^\s*\[[^\]]*\]\(\s*<?([^)>]+?)>?\s*\)\s*$/.exec(inner)?.[1]
  const text = (md ?? inner).split('|')[0].split('#')[0].trim()
  try {
    return md ? decodeURIComponent(text) : text
  } catch {
    return text
  }
}

const listOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && !!v.trim())
    : typeof value === 'string' && value.trim()
      ? [value]
      : []

/** The rule a note's properties hold; null when they name no forms. */
export function noteRuleOf(fm: Record<string, unknown> | null | undefined): NoteRule | null {
  if (!fm) return null
  const forms = parseForms(fm[WORD_FORMS])
  if (!forms.length) return null
  const lang = fm[WORD_LANGUAGE]
  const scope = typeof fm[WORD_SCOPE] === 'string' ? fm[WORD_SCOPE].trim().toLowerCase() : ''
  return {
    forms,
    language: typeof lang === 'string' ? lang.trim() : '',
    books: listOf(fm[WORD_BOOKS]).map(linkText).filter(Boolean),
    scope: scope === 'language' ? 'language' : 'book',
    on: !isOff(fm[WORD_UNDERLINE]),
  }
}

/** The primary language of a tag, lowercase: `lv` of `lv-LV`. */
export const primaryLanguage = (tag: string): string =>
  tag.trim().toLowerCase().split(/[-_]/)[0] ?? ''

/** Whether two language tags are one language: `lv` and `lv-LV` are. */
export function sameLanguage(a: string, b: string): boolean {
  const x = primaryLanguage(a)
  return !!x && x === primaryLanguage(b)
}

/** A book's languages as its metadata gives them: one tag, several, or none. */
export function languagesOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value]
  return list.filter((v): v is string => typeof v === 'string' && !!v.trim()).map((v) => v.trim())
}

/** The open book, as a rule asks about it. */
export interface BookRef {
  path: string
  /** Its languages, from the book itself (`dc:language`). */
  languages: string[]
}

/**
 * Whether a note's rule applies to the book: switched on, and the book is one it lists, or — with
 * the language scope — a book in its language. `resolve` says which file a link text goes to.
 */
export function ruleApplies(
  rule: NoteRule,
  book: BookRef,
  resolve: (link: string) => string | null
): boolean {
  if (!rule.on) return false
  if (rule.scope === 'language' && rule.language)
    return book.languages.some((l) => sameLanguage(l, rule.language))
  return rule.books.some((link) => link === book.path || resolve(link) === book.path)
}

const keysOf = (forms: string[]): string[] => [
  ...new Set(forms.map(formKey).filter((k): k is string => !!k)),
]

const nameOf = (path: string): string => path.split('/').pop()?.replace(/\.md$/i, '') ?? path

/** A note's rule as the book uses it. */
export function ruleOfNote(path: string, rule: NoteRule): VocabRule {
  return {
    id: `note:${path}`,
    forms: rule.forms,
    keys: keysOf(rule.forms),
    label: nameOf(path),
    target: { kind: 'note', path },
  }
}

/** The rules the book's highlights hold: each highlight with forms is one. */
export function highlightRules(list: Highlight[]): VocabRule[] {
  const out: VocabRule[] = []
  for (const h of list) {
    if (!h.forms?.length) continue
    const text = h.text.replace(/\s+/g, ' ').trim()
    out.push({
      id: `highlight:${h.cfi}`,
      forms: h.forms,
      keys: keysOf(h.forms),
      label: text.length > 40 ? `${text.slice(0, 39)}…` : text,
      target: { kind: 'highlight', cfi: h.cfi },
    })
  }
  return out
}

/** Every key the rules name, with the rules naming it, in the order given. */
export function formTable(rules: VocabRule[]): Map<string, VocabRule[]> {
  const table = new Map<string, VocabRule[]>()
  for (const rule of rules)
    for (const key of rule.keys) {
      const list = table.get(key)
      if (list) {
        if (!list.includes(rule)) list.push(rule)
      } else table.set(key, [rule])
    }
  return table
}

/** What `mark` changes in a note's properties. */
export interface MarkOptions {
  forms: string[]
  language?: string
  /** Links to the books, as a property keeps them: `[[Books/X.epub]]`. */
  books?: string[]
  scope?: RuleScope
  /** The forms given take the place of the note's, rather than being added to them. */
  replace?: boolean
}

/**
 * A note's properties with a rule written in, in place: forms and books added to what is there,
 * each once, nothing else touched; the language and scope set when given. Asked twice with the
 * same, it changes nothing the second time.
 */
export function markInto(fm: Record<string, unknown>, opts: MarkOptions): void {
  const given = parseForms(opts.forms)
  const forms = opts.replace ? given : parseForms([...parseForms(fm[WORD_FORMS]), ...given])
  if (JSON.stringify(fm[WORD_FORMS]) !== JSON.stringify(forms)) fm[WORD_FORMS] = forms
  if (opts.language?.trim() && fm[WORD_LANGUAGE] !== opts.language.trim())
    fm[WORD_LANGUAGE] = opts.language.trim()
  if (opts.books?.length) {
    const had = listOf(fm[WORD_BOOKS])
    const known = new Set(had.map(linkText))
    const added = opts.books.filter((b) => {
      const key = linkText(b)
      if (!key || known.has(key)) return false
      known.add(key)
      return true
    })
    if (added.length || !Array.isArray(fm[WORD_BOOKS])) fm[WORD_BOOKS] = [...had, ...added]
  }
  if (opts.scope && fm[WORD_SCOPE] !== opts.scope) {
    if (opts.scope === 'book' && fm[WORD_SCOPE] === undefined) return
    fm[WORD_SCOPE] = opts.scope
  }
}

/** A note's properties with its rule switched on or off; the forms stay. */
export function switchInto(fm: Record<string, unknown>, on: boolean): void {
  if (on) delete fm[WORD_UNDERLINE]
  else fm[WORD_UNDERLINE] = false
}
