/**
 * Dates of history as people write them in a note: `1564`, `ок. 1450`, `1560-е`, `XVI век`,
 * `490 до н.э.`, `-490`, `вторая половина XVI века`, `1440–1455`, `now`. Pure, no Obsidian.
 *
 * Every date becomes a stretch of one line of years — fractional, so a month or a day is a part
 * of its year — with no `Date` involved: `Date` has nothing to say about "the 1560s" and trips
 * over years before 100. The line is astronomical: 1 BC is year 0, 490 BC is -489, so a length is
 * a plain subtraction and Augustus (63 BC – AD 14) lived 76 years, not 77. On screen and in text
 * the years are the human ones again, and a minus sign typed by a person means BC — `-490` is
 * 490 BC, not the -0489 of EDTF, whose year zero would catch every hand-written note.
 *
 * A date carries where it may be at the earliest (`lo`), at the latest (`hi`) and the moment it
 * is drawn and counted at (`at`): a plain year is its first day, anything vague its middle.
 */

export type HistPrecision =
  | 'day'
  | 'month'
  | 'year'
  | 'decade'
  | 'century'
  | 'part'
  | 'millennium'
  | 'range'

export interface HistDate {
  /** The earliest the date may be, in astronomical years. */
  lo: number
  /** The latest, the end of its last possible day. */
  hi: number
  /** Where it is drawn and counted from. */
  at: number
  precision: HistPrecision
  /** Drawn with a soft edge from `lo` to `hi` rather than a sharp one at `at`. */
  fuzzy: boolean
  /** "About": `ок.`, `~`, `c.`. */
  approx: boolean
  /** "Perhaps": a question mark. */
  uncertain: boolean
  /** Still going: `now`, `сейчас`. */
  now: boolean
  /** As written in the note. */
  text: string
}

export interface HistParseOptions {
  /** How many years "about" reaches either way. */
  approx: number
  /** Today, as a fractional year: what `now` means. */
  now: number
}

export type HistLang = 'en' | 'ru'

/** A person's year (…, -2, -1, 1, 2, …) on the line, where 1 BC is 0. */
export const astroYear = (human: number): number => (human < 0 ? human + 1 : human)

/** The person's year a point of the line falls in. */
export function humanYear(t: number): number {
  const y = Math.floor(t)
  return y <= 0 ? y - 1 : y
}

const isLeap = (y: number) => {
  const m = ((y % 400) + 400) % 400
  return m % 4 === 0 && (m % 100 !== 0 || m === 0)
}
export const daysIn = (y: number): number => (isLeap(y) ? 366 : 365)
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const monthDays = (y: number, m: number) => (m === 2 && isLeap(y) ? 29 : MONTH_DAYS[m - 1])

/** Day `day` of month `month` (1-based) of astronomical year `y`, as a point of the line. */
export function dayPoint(y: number, month: number, day: number): number {
  let n = day - 1
  for (let m = 1; m < month; m++) n += monthDays(y, m)
  return y + n / daysIn(y)
}

/** Today, as a point of the line. */
export function todayPoint(date = new Date()): number {
  return dayPoint(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

const MONTHS: Record<string, number> = {}
;[
  ['январь', 'января', 'january', 'jan'],
  ['февраль', 'февраля', 'february', 'feb'],
  ['март', 'марта', 'march', 'mar'],
  ['апрель', 'апреля', 'april', 'apr'],
  ['май', 'мая', 'may'],
  ['июнь', 'июня', 'june', 'jun'],
  ['июль', 'июля', 'july', 'jul'],
  ['август', 'августа', 'august', 'aug'],
  ['сентябрь', 'сентября', 'september', 'sep', 'sept'],
  ['октябрь', 'октября', 'october', 'oct'],
  ['ноябрь', 'ноября', 'november', 'nov'],
  ['декабрь', 'декабря', 'december', 'dec'],
].forEach((names, i) => names.forEach((n) => (MONTHS[n] = i + 1)))

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 }

/** `xvi` or `16` as a number; null for anything else. */
function ordinal(text: string): number | null {
  if (/^\d{1,2}$/.test(text)) return Number(text) || null
  if (!/^[ivxlc]+$/.test(text)) return null
  let total = 0
  for (let i = 0; i < text.length; i++) {
    const v = ROMAN[text[i]]
    const next = ROMAN[text[i + 1]] ?? 0
    total += v < next ? -v : v
  }
  return total > 0 && total <= 60 ? total : null
}

const NOW_RE =
  /^(now|present|today|сейчас|наст\.? время|настоящее время|по настоящее время|по н\.в\.|н\.в\.|до сих пор)$/
const APPROX_RE = /^(ок\.|около|примерно|приблизительно|~|c\.|ca\.?|circa|approx\.?|about)\s*/
const BCE_RE = /\s*(до\s*н\.?\s*э\.?|до\s*р\.?\s*х\.?|b\.?\s*c\.?\s*e?\.?)$/
const CE_RE = /\s*(н\.?\s*э\.?|a\.?\s*d\.?|c\.?\s*e\.?)$/
const AD_PREFIX_RE = /^a\.?d\.?\s+/
const YEAR_WORD_RE = /\s*(гг?\.|года?|год)$/

interface Core {
  lo: number
  hi: number
  at: number
  precision: HistPrecision
  fuzzy: boolean
}

type Era = 'bce' | 'ce' | null

/** The era written at the end of `s`, and `s` without it. */
function splitEra(s: string): [string, Era] {
  const bce = BCE_RE.exec(s)
  if (bce && bce.index > 0) return [s.slice(0, bce.index).trim(), 'bce']
  const ad = AD_PREFIX_RE.exec(s)
  if (ad) return [s.slice(ad[0].length).trim(), 'ce']
  const ce = CE_RE.exec(s)
  // "c." alone is "circa", and a lone "16th c." is a century: only an era after a number.
  if (ce && ce.index > 0 && /\d$/.test(s.slice(0, ce.index).trim()))
    return [s.slice(0, ce.index).trim(), 'ce']
  return [s, null]
}

/** A year as written — negative meaning BC unless an era says otherwise — on the line. */
function yearOf(written: number, era: Era): number {
  if (era === 'bce') return astroYear(-Math.abs(written))
  return astroYear(written)
}

const span = (lo: number, hi: number, precision: HistPrecision, fuzzy: boolean): Core => ({
  lo,
  hi,
  at: fuzzy ? (lo + hi) / 2 : lo,
  precision,
  fuzzy,
})

/** A century (or a millennium, `size` 1000) counted the human way: the 16th is 1501 to 1600. */
function countedSpan(n: number, size: number, era: Era): [number, number] {
  if (era === 'bce') return [1 - n * size, 1 - (n - 1) * size]
  return [(n - 1) * size + 1, n * size + 1]
}

const PARTS: [RegExp, number, number][] = [
  [/^(начало|early|beginning of( the)?)\s+/, 0, 1 / 3],
  [/^(середина|mid-?|middle of( the)?)\s*/, 1 / 3, 2 / 3],
  [/^(конец|late|end of( the)?)\s+/, 2 / 3, 1],
  [/^(первая половина|first half of( the)?)\s+/, 0, 1 / 2],
  [/^(вторая половина|second half of( the)?)\s+/, 1 / 2, 1],
  [/^(первая четверть|first quarter of( the)?)\s+/, 0, 1 / 4],
  [/^(вторая четверть|second quarter of( the)?)\s+/, 1 / 4, 1 / 2],
  [/^(третья четверть|third quarter of( the)?)\s+/, 1 / 2, 3 / 4],
  [
    /^(последняя четверть|четвёртая четверть|четвертая четверть|last quarter of( the)?|fourth quarter of( the)?)\s+/,
    3 / 4,
    1,
  ],
]

const CENTURY_RE =
  /^([ivxlc]+|\d{1,2})(?:-?(?:й|ый|ой|th|st|nd|rd))?\s*(век|века|вв\.|вв|в\.|в|c\.|c|cent\.?|century|centuries)$/
const MILLENNIUM_RE =
  /^([ivxlc]+|\d{1,2})(?:-?(?:е|й|ое|th|st|nd|rd))?\s*(тыс\.|тыс|тысячелетие|тысячелетия|millennium)$/

/** One date, era already split off; null when it is not one. */
function parseCore(s: string, era: Era): Core | null {
  s = s.replace(YEAR_WORD_RE, '').trim()
  let m: RegExpExecArray | null

  // A plain year; a minus is BC.
  if ((m = /^(-?)(\d{1,4})$/.exec(s))) {
    const y = yearOf(Number(m[2]) * (m[1] ? -1 : 1), m[1] ? 'bce' : era)
    return span(y, y + 1, 'year', false)
  }
  // ISO: a month, a day, perhaps a time after it.
  if ((m = /^(-?)(\d{1,4})-(\d{2})(?:-(\d{2}))?(?:[t\s]\d{1,2}:\d{2}.*)?$/.exec(s))) {
    const y = yearOf(Number(m[2]) * (m[1] ? -1 : 1), m[1] ? 'bce' : era)
    return monthOrDay(y, Number(m[3]), m[4] ? Number(m[4]) : null)
  }
  // A day in words: "26 апреля 1564", "April 26, 1564"; a month in words: "April 1564".
  if ((m = /^(\d{1,2})\s+([a-zа-яё]+)\.?,?\s+(-?\d{1,4})$/.exec(s)) && MONTHS[m[2]])
    return monthOrDay(yearOf(Number(m[3]), era), MONTHS[m[2]], Number(m[1]))
  if ((m = /^([a-zа-яё]+)\.?\s+(\d{1,2}),?\s+(-?\d{1,4})$/.exec(s)) && MONTHS[m[1]])
    return monthOrDay(yearOf(Number(m[3]), era), MONTHS[m[1]], Number(m[2]))
  if ((m = /^([a-zа-яё]+)\.?,?\s+(-?\d{1,4})$/.exec(s)) && MONTHS[m[1]])
    return monthOrDay(yearOf(Number(m[2]), era), MONTHS[m[1]], null)
  // A decade: "1560-е", "1560s", "1560-х", EDTF's "156x".
  if ((m = /^(\d{1,3})0\s*(?:-?е|-?х|-?ые|-?ых|'?s)$/.exec(s)) || (m = /^(\d{1,3})x$/.exec(s))) {
    const first = Number(m[1]) * 10
    if (era === 'bce') {
      // The 490s BC are 499 to 490 BC.
      const lo = astroYear(-(first + 9))
      return span(lo, lo + 10, 'decade', true)
    }
    return span(first, first + 10, 'decade', true)
  }
  // EDTF's "15xx": the hundred years that begin with 15.
  if ((m = /^(\d{1,2})xx$/.exec(s))) {
    const first = Number(m[1]) * 100
    return span(first, first + 100, 'century', true)
  }
  // A century, perhaps only a part of one.
  let part: [number, number] | null = null
  for (const [re, from, to] of PARTS) {
    const p = re.exec(s)
    if (p) {
      part = [from, to]
      s = s.slice(p[0].length).trim()
      break
    }
  }
  if ((m = CENTURY_RE.exec(s))) {
    const n = ordinal(m[1])
    if (!n) return null
    const [lo, hi] = countedSpan(n, 100, era)
    if (!part) return span(lo, hi, 'century', true)
    return span(lo + (hi - lo) * part[0], lo + (hi - lo) * part[1], 'part', true)
  }
  if (!part && (m = MILLENNIUM_RE.exec(s))) {
    const n = ordinal(m[1])
    if (!n) return null
    const [lo, hi] = countedSpan(n, 1000, era)
    return span(lo, hi, 'millennium', true)
  }
  return null
}

function monthOrDay(y: number, month: number, day: number | null): Core | null {
  if (month < 1 || month > 12) return null
  if (day === null) {
    const lo = dayPoint(y, month, 1)
    const hi = month === 12 ? y + 1 : dayPoint(y, month + 1, 1)
    return span(lo, hi, 'month', false)
  }
  if (day < 1 || day > monthDays(y, month)) return null
  const lo = dayPoint(y, month, day)
  return span(lo, lo + 1 / daysIn(y), 'day', false)
}

/** One kind of dash and single spaces; the case is kept for the text of a range's sides. */
function normalise(text: string): string {
  return text
    .trim()
    .replace(/[‒–—―−]/g, (c) => (c === '−' ? '-' : '–'))
    .replace(/\s+/g, ' ')
}

/** "ок. 1450", "1450?", "1450~" — the date and what was said about it. */
function parseQualified(
  s: string,
  inherited: Era,
  opts: HistParseOptions
): (Core & { approx: boolean; uncertain: boolean }) | null {
  let approx = false
  let uncertain = false
  const a = APPROX_RE.exec(s)
  if (a) {
    approx = true
    s = s.slice(a[0].length).trim()
  }
  if (/[?%]$/.test(s)) {
    uncertain = true
    s = s.slice(0, -1).trim()
  }
  if (/~$/.test(s)) {
    approx = true
    s = s.slice(0, -1).trim()
  }
  const [rest, era] = splitEra(s)
  const core = parseCore(rest, era ?? inherited)
  if (!core) return null
  if (!approx && !uncertain) return { ...core, approx, uncertain }
  return {
    lo: core.lo - opts.approx,
    hi: core.hi + opts.approx,
    at: core.at,
    precision: core.precision,
    fuzzy: true,
    approx,
    uncertain,
  }
}

/** The two sides of a range, or null when `s` is one date. */
function splitRange(s: string): [string, string] | null {
  // "с 1914 по 1918", "from 1914 to 1918"
  let m = /^(?:с|from)\s+(.+?)\s+(?:по|до|to|until)\s+(.+)$/i.exec(s)
  if (m) return [m[1], m[2]]
  m = /^(.+?)\s*(?:–|\.\.|\s-\s|\s+to\s+|\s+по\s+)\s*(.+)$/i.exec(s)
  if (m) return [m[1], m[2]]
  // A hyphen between two years is a range; "1440-12" is a month.
  m = /^(\d{1,4})-(\d{3,4})(.*)$/.exec(s)
  return m ? [m[1], m[2] + m[3]] : null
}

const whole = (d: Core & { approx: boolean; uncertain: boolean }, text: string): HistDate => ({
  ...d,
  now: false,
  text,
})

const nowDate = (opts: HistParseOptions, text: string): HistDate => ({
  lo: opts.now,
  hi: opts.now,
  at: opts.now,
  precision: 'day',
  fuzzy: false,
  approx: false,
  uncertain: false,
  now: true,
  text,
})

/** Both sides of a range; an era written once at its end holds for both. */
function parseSides(sides: [string, string], opts: HistParseOptions): [HistDate, HistDate] | null {
  const [a, b] = sides
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  const [, eraB] = splitEra(lb.replace(/[?~%]$/, ''))
  const [, eraA] = splitEra(la.replace(/[?~%]$/, ''))
  // "XVI–XVII вв.", "5th–4th centuries BC": the unit written once, after the second.
  const unit = /\s*(вв?\.?|век|века|веков|c\.|cent\.?|centuries|century)(\s.*)?$/.exec(lb)
  const start =
    parseQualified(la, eraA ?? eraB, opts) ??
    (unit && /^([ivxlc]+|\d{1,2})(-?(й|th|st|nd|rd))?$/.test(la.trim())
      ? parseQualified(`${la.trim()} век`, eraA ?? eraB, opts)
      : null)
  if (!start) return null
  if (NOW_RE.test(lb)) return [whole(start, a), nowDate(opts, b)]
  const end = parseQualified(lb, null, opts)
  return end ? [whole(start, a), whole(end, b)] : null
}

const cache = new Map<string, HistDate | null>()
const CACHE_LIMIT = 50_000

/** The text of a property's value, or null for anything that is not one. */
function textOf(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return null
  const t = value.trim()
  return t ? t : null
}

/**
 * A date as a note writes it; null when it is not one. A range here means the date lies
 * somewhere between its ends — "born 1440–1455" — and is read as one vague date.
 */
export function parseHistDate(value: unknown, opts: HistParseOptions): HistDate | null {
  const text = textOf(value)
  if (text === null) return null
  const tidy = normalise(text)
  const s = tidy.toLowerCase()
  if (NOW_RE.test(s)) return nowDate(opts, text)
  const key = `${opts.approx}|${s}`
  const known = cache.get(key)
  if (known !== undefined) return known ? { ...known, text } : null
  let found: HistDate | null = null
  const single = parseQualified(s, null, opts)
  if (single) found = whole(single, text)
  else {
    const sides = splitRange(tidy)
    const both = sides && parseSides(sides, opts)
    if (both && !both[1].now && both[1].hi >= both[0].lo) {
      const [a, b] = both
      found = {
        lo: a.lo,
        hi: b.hi,
        at: (a.lo + b.hi) / 2,
        precision: 'range',
        fuzzy: true,
        approx: a.approx || b.approx,
        uncertain: a.uncertain || b.uncertain,
        now: false,
        text,
      }
    }
  }
  if (cache.size > CACHE_LIMIT) cache.clear()
  cache.set(key, found)
  return found
}

/** A whole span written in one field — `1914–1918`, `1991 – present`; null for one date. */
export function parsePeriod(
  value: unknown,
  opts: HistParseOptions
): { start: HistDate; end: HistDate } | null {
  const text = textOf(value)
  if (text === null) return null
  const sides = splitRange(normalise(text))
  const both = sides && parseSides(sides, opts)
  if (!both) return null
  // The sides as written, from the original text, so a label shows them as they are.
  return { start: both[0], end: both[1] }
}

/** Whole years from one date to another, counted from where each is drawn. */
export const yearsBetween = (a: HistDate, b: HistDate): number => Math.floor(b.at - a.at + 1e-9)

/** The year a point falls in, the way the app's language writes it. */
export function formatYear(t: number, lang: HistLang): string {
  const y = Math.floor(t)
  if (y > 0) return String(y)
  return lang === 'ru' ? `${1 - y} до н.э.` : `${1 - y} BC`
}

const plain = (d: HistDate) =>
  !d.approx && !d.uncertain && !d.now && ['year', 'month', 'day'].includes(d.precision)

const NOW_WORD: Record<HistLang, string> = { en: 'now', ru: 'сейчас' }

/** A date in a label: a plain one as its year, anything vague as it was written. */
export function formatDate(d: HistDate, lang: HistLang): string {
  if (d.now) return NOW_WORD[lang]
  return plain(d) ? formatYear(d.at, lang) : d.text
}

/** `1564–1616`, `470–399 до н.э.`, `ок. 1450–1516`: what a bar's label says after the name. */
export function formatSpan(start: HistDate, end: HistDate | null, lang: HistLang): string {
  if (!end) return formatDate(start, lang)
  if (plain(start) && plain(end) && start.at < 1 && end.at < 1) {
    const era = lang === 'ru' ? 'до н.э.' : 'BC'
    return `${1 - Math.floor(start.at)}–${1 - Math.floor(end.at)} ${era}`
  }
  return `${formatDate(start, lang)}–${formatDate(end, lang)}`
}
