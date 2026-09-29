/**
 * Words as a vocabulary rule compares them: a form and a word of the book are the same when they
 * are the same letters, whatever the case and however the letters are encoded (NFC). Letters with
 * and without a diacritic stay different words — `mājas` is not `majas`, `всё` is not `все` — and
 * nothing is reduced to a stem: another form of a word is another form to list.
 *
 * A word of the book is a run of letters, marks and digits. An apostrophe or a hyphen between
 * letters joins the run (`don't`, `l'homme`, `какой-то`), and its parts are words too, so a form
 * matches the whole or a part: `homme` in `l'homme`. A soft hyphen or a zero-width joiner inside a
 * word is not part of it.
 *
 * Everything here works on text, so the rules are tested without a book.
 */

/** Characters inside a word that are not part of it: a soft hyphen, zero-width (non-)joiners. */
const IGNORED = new RegExp('\\u00AD|\\u200C|\\u200D|\\u2060|\\uFEFF', 'g')
/** Apostrophes and hyphens as one character each. */
const APOSTROPHES = new RegExp('[\\u2019\\u02BC\\u2018]', 'g')
const HYPHENS = new RegExp('[\\u2010\\u2011]', 'g')

/** A word of the book: letters, marks, digits, joined by an apostrophe or a hyphen. */
const PART = '(?:[\\p{L}\\p{M}\\p{N}\\u00AD\\u2060\\uFEFF]|\\u200C|\\u200D)+'
const JOIN = "['\\u2019\\u02BC\\-\\u2010\\u2011]"
export const WORD = new RegExp(`${PART}(?:${JOIN}${PART})*`, 'gu')
const JOINER = new RegExp(JOIN, 'u')
const JOINERS = new RegExp(JOIN, 'gu')

/** A word or a form as it is compared: lowercase, NFC, one apostrophe and one hyphen. */
export function wordKey(word: string): string {
  return word
    .normalize('NFC')
    .replace(IGNORED, '')
    .replace(APOSTROPHES, "'")
    .replace(HYPHENS, '-')
    .toLowerCase()
    .normalize('NFC')
}

/**
 * The forms a person wrote, as a list: split on commas, semicolons and new lines, trimmed, each
 * kept once (as compared), in the order given. What holds no letter is dropped.
 */
export function parseForms(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.flatMap((v) => (typeof v === 'string' || typeof v === 'number' ? [String(v)] : []))
    : typeof value === 'string' || typeof value === 'number'
      ? [String(value)]
      : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw)
    for (const piece of item.split(/[,;\n]/)) {
      const form = piece.trim().normalize('NFC')
      if (!/[\p{L}\p{N}]/u.test(form)) continue
      const key = wordKey(form)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(form)
    }
  return out
}

/** Forms written back as a line: `a, b, c`. */
export const formsLine = (forms: string[]): string => forms.join(', ')

/** The keys a form matches: itself, and nothing when it is more than one word. */
export function formKey(form: string): string | null {
  const key = wordKey(form.trim())
  if (!key) return null
  WORD.lastIndex = 0
  const m = WORD.exec(key)
  return m && m.index === 0 && m[0].length === key.length ? key : null
}

/** One word of the book the forms name: where it is in the text, and its key. */
export interface WordMatch {
  start: number
  end: number
  key: string
}

/**
 * The words of `text` whose key is in `keys`, in order, from `from` on. A joined word that is a
 * form is taken whole; otherwise each of its parts that is a form is. At most `budget` words are
 * looked at: `next` is where to go on from, -1 once the text is done — so a long chapter is read a
 * piece at a time, the thread handed back in between.
 */
export function findWords(
  text: string,
  keys: ReadonlySet<string>,
  from = 0,
  budget = Infinity
): { matches: WordMatch[]; next: number } {
  const matches: WordMatch[] = []
  if (!keys.size) return { matches, next: -1 }
  const re = new RegExp(WORD.source, 'gu')
  re.lastIndex = from
  let seen = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const word = m[0]
    const start = m.index
    const key = wordKey(word)
    if (keys.has(key)) matches.push({ start, end: start + word.length, key })
    else if (JOINER.test(word)) {
      // The parts of a joined word, each a word of its own.
      let at = 0
      for (const piece of word.split(JOINERS)) {
        const k = wordKey(piece)
        if (k && keys.has(k))
          matches.push({ start: start + at, end: start + at + piece.length, key: k })
        at += piece.length + 1
      }
    }
    if (++seen >= budget) return { matches, next: re.lastIndex }
  }
  return { matches, next: -1 }
}
