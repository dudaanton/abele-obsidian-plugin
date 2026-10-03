/**
 * The rules the plugin ships with. Each is pure: it reads a `LintNote` and says what is wrong, and
 * its fix — where there is one — hands back the whole text with that put right, or `null`.
 *
 * Which of them run, where, and with what parameters is the person's choice (`settings.ts`);
 * `enabledByDefault` is only where a fresh vault starts.
 */
import dayjs from 'dayjs'
import { parseCommaList } from '@/helpers/displayFormat'
import {
  filled,
  keyAndDefault,
  lineBreakOf,
  propertyEntries,
  proseLines,
  slippedProperties,
  withProperty,
  withoutProperty,
} from './note'
import type { LintFinding, LintNote, LintParams, LintRule } from './types'

const list = (params: LintParams, name: string): string[] => {
  const value = params[name]
  if (Array.isArray(value))
    return value
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean)
  if (typeof value === 'string') return parseCommaList(value)
  return []
}
const text = (params: LintParams, name: string): string => {
  const value = params[name]
  return typeof value === 'string' ? value.trim() : ''
}
const flag = (params: LintParams, name: string): boolean => params[name] !== false

/** The parameters a rule starts with. */
export function defaultParams(rule: LintRule): LintParams {
  return Object.fromEntries(rule.params.map((p) => [p.name, p.default]))
}

/**
 * Properties no rule about their values should touch: a block that cannot be read, or one that
 * slipped down the note — `frontmatter-valid` deals with both, and a property added meanwhile
 * would start a second block above the first.
 */
const unreadable = (note: LintNote): boolean =>
  (note.hasFrontmatter && !note.frontmatter) || !!slippedProperties(note)

/** The line a finding about the properties points at: the block's first line. */
const PROPERTIES_LINE = 1

/** The line of a property inside the block, or the block's first line. */
function propertyLine(note: LintNote, key: string): number {
  if (!note.frontmatterEnd) return PROPERTIES_LINE
  const entry = propertyEntries(note.lines, note.frontmatterEnd - 1).find((e) => e.key === key)
  return entry ? entry.start + 1 : PROPERTIES_LINE
}

/** The properties' text as a list of `(key, lines)` for finding repeats. */
function duplicates(note: LintNote): { key: string; line: number; same: boolean }[] {
  if (!note.frontmatterEnd) return []
  const seen = new Map<string, string>()
  const out: { key: string; line: number; same: boolean }[] = []
  for (const e of propertyEntries(note.lines, note.frontmatterEnd - 1)) {
    const value = note.lines
      .slice(e.start, e.end)
      .join('\n')
      .replace(/^[^:]*:/, '')
      .trim()
    const before = seen.get(e.key)
    if (before === undefined) seen.set(e.key, value)
    else out.push({ key: e.key, line: e.start + 1, same: before === value })
  }
  return out
}

const frontmatterPresent: LintRule = {
  id: 'frontmatter-present',
  title: 'Has properties',
  description: 'The note starts with a properties block (--- on its first line).',
  severity: 'error',
  params: [],
  enabledByDefault: true,
  source: 'builtin',
  check(note) {
    if (note.hasFrontmatter || slippedProperties(note)) return []
    return [{ message: 'No properties: the note does not start with a --- block', line: 1 }]
  },
}

const frontmatterValid: LintRule = {
  id: 'frontmatter-valid',
  title: 'Properties can be read',
  description:
    'The properties block is on the first line, is closed, is valid YAML and names no property twice. ' +
    'A block that slipped down the note is moved back to the top; a property repeated with the same value is taken out.',
  severity: 'error',
  params: [],
  enabledByDefault: true,
  source: 'builtin',
  check(note) {
    const slipped = slippedProperties(note)
    if (slipped) {
      const where = slipped.start === 1 ? 'behind an invisible mark' : `at line ${slipped.start}`
      return [
        {
          message: `The properties start ${where}, not on the first line, so Obsidian does not read them`,
          line: slipped.start,
          fixable: true,
        },
      ]
    }
    if (!note.hasFrontmatter) return []
    const repeated = duplicates(note)
    if (repeated.length) {
      return repeated.map((d) => ({
        message: d.same
          ? `The property ${d.key} is written twice`
          : `The property ${d.key} is written twice with different values`,
        line: d.line,
        fixable: d.same,
      }))
    }
    if (!note.frontmatterError) return []
    const never = /never closed/.test(note.frontmatterError)
    return [
      {
        message: never
          ? 'The properties are never closed with a line of ---'
          : `The properties cannot be read: ${note.frontmatterError}`,
        line: note.frontmatterErrorLine || PROPERTIES_LINE,
        fixable: false,
      },
    ]
  },
  fix(note) {
    const br = lineBreakOf(note.content)
    const slipped = slippedProperties(note)
    if (slipped) {
      const lines = note.lines.map((l, i) => (i === 0 ? l.replace(/^\uFEFF/, '') : l))
      const block = lines.slice(slipped.start - 1, slipped.end)
      const above = lines.slice(0, slipped.start - 1)
      const below = lines.slice(slipped.end)
      const kept = slipped.onlyBlankAbove ? [] : above
      return [...block, ...kept, ...below].join(br)
    }
    const same = duplicates(note).filter((d) => d.same)
    if (!same.length) return null
    const entries = propertyEntries(note.lines, note.frontmatterEnd - 1)
    const drop = entries.filter((e) => same.some((d) => d.line === e.start + 1))
    return note.lines.filter((_, i) => !drop.some((e) => i >= e.start && i < e.end)).join(br)
  },
}

/** A default's `{{ctime}}` and `{{today}}`, filled for this note; null when it cannot be. */
function fillDefault(value: string, note: LintNote): string | null {
  let out = value
  if (out.includes('{{ctime}}')) {
    const when = note.ctime || note.mtime
    if (!when) return null
    out = out.split('{{ctime}}').join(dayjs(when).format('YYYY-MM-DD'))
  }
  return out.split('{{today}}').join(dayjs().format('YYYY-MM-DD'))
}

const requiredProperties: LintRule = {
  id: 'required-properties',
  title: 'Required properties',
  description:
    'The listed properties are there and filled in. An entry may carry a default after a colon — ' +
    '"created: {{ctime}}" fills in the day the file was made, {{today}} is today — and only those are fixed.',
  severity: 'error',
  params: [
    {
      name: 'properties',
      label: 'Properties',
      description: 'Comma-separated. "name: default" to have the fix fill it in.',
      type: 'list',
      default: ['created: {{ctime}}'],
    },
  ],
  enabledByDefault: true,
  source: 'builtin',
  check(note, params) {
    if (unreadable(note)) return []
    const fm = note.frontmatter ?? {}
    return list(params, 'properties')
      .map(keyAndDefault)
      .filter(({ key }) => key && !filled(fm[key]))
      .map(({ key, value }) => ({
        message: `Missing property ${key}`,
        line: note.frontmatterEnd ? propertyLine(note, key) : PROPERTIES_LINE,
        fixable: value !== null && value !== '' && fillDefault(value, note) !== null,
      }))
  },
  fix(note, params) {
    if (unreadable(note)) return null
    const fm = note.frontmatter ?? {}
    let out = note.content
    for (const { key, value } of list(params, 'properties').map(keyAndDefault)) {
      if (!key || filled(fm[key]) || value === null || value === '') continue
      const filledIn = fillDefault(value, note)
      if (filledIn !== null) out = withProperty(out, key, filledIn)
    }
    return out === note.content ? null : out
  },
}

const noteType: LintRule = {
  id: 'note-type',
  title: 'Has a note type',
  description:
    'The note says what it is in its type property — task, person, meeting. With a list of types, the value must be one of them.',
  severity: 'warning',
  params: [
    {
      name: 'property',
      label: 'Property',
      description: 'Where the type is written.',
      type: 'text',
      default: 'type',
    },
    {
      name: 'allowed',
      label: 'Allowed types',
      description: 'Comma-separated. Empty lets any value through.',
      type: 'list',
      default: [],
    },
    {
      name: 'default',
      label: 'Default',
      description: 'Written by the fix into a note without a type. Empty: nothing is fixed.',
      type: 'text',
      default: '',
    },
  ],
  enabledByDefault: false,
  source: 'builtin',
  check(note, params) {
    if (unreadable(note)) return []
    const key = text(params, 'property') || 'type'
    const value = (note.frontmatter ?? {})[key]
    const allowed = list(params, 'allowed')
    if (!filled(value)) {
      return [
        {
          message: `No note type: ${key} is empty`,
          line: propertyLine(note, key),
          fixable: !!text(params, 'default'),
        },
      ]
    }
    const values = (Array.isArray(value) ? value : [value]).map(String)
    if (allowed.length && !values.some((v) => allowed.includes(v))) {
      return [
        {
          message: `The type ${values.join(', ')} is not one of ${allowed.join(', ')}`,
          line: propertyLine(note, key),
          fixable: false,
        },
      ]
    }
    return []
  },
  fix(note, params) {
    const key = text(params, 'property') || 'type'
    const fallback = text(params, 'default')
    if (!fallback || unreadable(note)) return null
    if (filled((note.frontmatter ?? {})[key])) return null
    return withProperty(note.content, key, fallback)
  },
}

/** Obsidian's tag: `#` after a space or the start, then letters, digits, `_`, `-`, `/`, not only digits. */
const INLINE_TAG = /(^|\s)#([\p{L}\p{N}_\-/]+)/gu
const TAG_PROPERTIES = ['tags', 'tag']

const noTags: LintRule = {
  id: 'no-tags',
  title: 'No tags',
  description:
    'For a vault that does not use tags: the tags property is taken out by the fix; a #tag in the text is shown to be dealt with by hand.',
  severity: 'warning',
  params: [
    {
      name: 'inline',
      label: 'Tags in the text',
      description: 'Also find #tags written in the text.',
      type: 'boolean',
      default: true,
    },
  ],
  enabledByDefault: false,
  source: 'builtin',
  check(note, params) {
    const out: LintFinding[] = []
    const fm = note.frontmatter ?? {}
    for (const key of Object.keys(fm)) {
      if (!TAG_PROPERTIES.includes(key.toLowerCase())) continue
      out.push({
        message: `The note has tags in ${key}`,
        line: propertyLine(note, key),
        fixable: true,
      })
    }
    if (!flag(params, 'inline')) return out
    for (const { line, text: raw } of proseLines(note)) {
      const plain = raw.replace(/`[^`]*`/g, '')
      for (const m of plain.matchAll(INLINE_TAG)) {
        if (/^\d+$/.test(m[2])) continue
        out.push({ message: `The tag #${m[2]} is in the text`, line, fixable: false })
      }
    }
    return out
  },
  fix(note) {
    let out = note.content
    for (const key of Object.keys(note.frontmatter ?? {})) {
      if (TAG_PROPERTIES.includes(key.toLowerCase())) out = withoutProperty(out, key)
    }
    return out === note.content ? null : out
  },
}

const forbiddenProperties: LintRule = {
  id: 'forbidden-properties',
  title: 'Unwanted properties',
  description: 'None of the listed properties is there. The fix takes them out.',
  severity: 'warning',
  params: [
    {
      name: 'properties',
      label: 'Properties',
      description: 'Comma-separated.',
      type: 'list',
      default: [],
    },
  ],
  enabledByDefault: false,
  source: 'builtin',
  check(note, params) {
    const fm = note.frontmatter ?? {}
    return list(params, 'properties')
      .filter((key) => key in fm)
      .map((key) => ({
        message: `The property ${key} is not wanted`,
        line: propertyLine(note, key),
        fixable: true,
      }))
  },
  fix(note, params) {
    const fm = note.frontmatter ?? {}
    let out = note.content
    for (const key of list(params, 'properties')) if (key in fm) out = withoutProperty(out, key)
    return out === note.content ? null : out
  },
}

/** The blank lines right under the properties, and whether any text follows them. */
function gapAfterProperties(note: LintNote): { blanks: number; textFollows: boolean } | null {
  if (!note.frontmatterEnd) return null
  let blanks = 0
  const rest = note.lines.slice(note.frontmatterEnd)
  while (blanks < rest.length && !rest[blanks].trim()) blanks++
  return { blanks, textFollows: blanks < rest.length }
}

const blankLineAfterFrontmatter: LintRule = {
  id: 'blank-line-after-frontmatter',
  title: 'Blank line after the properties',
  description: 'Exactly one blank line stands between the properties and the text.',
  severity: 'warning',
  params: [],
  enabledByDefault: true,
  source: 'builtin',
  check(note) {
    const gap = gapAfterProperties(note)
    if (!gap?.textFollows || gap.blanks === 1) return []
    return [
      {
        message:
          gap.blanks === 0
            ? 'No blank line between the properties and the text'
            : `${gap.blanks} blank lines between the properties and the text, one is enough`,
        line: note.frontmatterEnd + 1,
        fixable: true,
      },
    ]
  },
  fix(note) {
    const gap = gapAfterProperties(note)
    if (!gap?.textFollows || gap.blanks === 1) return null
    const lines = [...note.lines]
    lines.splice(note.frontmatterEnd, gap.blanks, '')
    return lines.join(lineBreakOf(note.content))
  },
}

const H1 = /^#\s+(.*?)\s*#*\s*$/

const noH1: LintRule = {
  id: 'no-h1',
  title: 'No first-level heading',
  description:
    'The file name is the title, so the text has no # heading. The fix takes out one that repeats the name and makes any other a ## heading.',
  severity: 'warning',
  params: [],
  enabledByDefault: true,
  source: 'builtin',
  check(note) {
    return proseLines(note)
      .filter(({ text: t }) => H1.test(t))
      .map(({ line }) => ({
        message: 'A first-level heading; the file name is the title',
        line,
        fixable: true,
      }))
  },
  fix(note) {
    const headings = proseLines(note).filter(({ text: t }) => H1.test(t))
    if (!headings.length) return null
    const lines = [...note.lines]
    const drop = new Set<number>()
    for (const { line, text: t } of headings) {
      const i = line - 1
      const title = H1.exec(t)?.[1] ?? ''
      if (title.trim().toLowerCase() === note.name.trim().toLowerCase()) {
        drop.add(i)
        // The blank line under a removed title goes with it, if one stays above.
        const aboveBlank = i === 0 || !lines[i - 1].trim() || i === note.frontmatterEnd
        if (aboveBlank && i + 1 < lines.length && !lines[i + 1].trim()) drop.add(i + 1)
      } else {
        lines[i] = '#' + t
      }
    }
    return lines.filter((_, i) => !drop.has(i)).join(lineBreakOf(note.content))
  },
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A date in a shape people type, as YYYY-MM-DD; null when it is not a real date. */
function asPlainDate(value: string): string | null {
  const v = value.trim().replace(/^\[\[(.+)\]\]$/, '$1')
  let y: number, m: number, d: number
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v)
  if (match) [y, m, d] = [+match[1], +match[2], +match[3]]
  else if ((match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v)))
    [d, m, y] = [+match[1], +match[2], +match[3]]
  else return null
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const dateProperties: LintRule = {
  id: 'date-properties',
  title: 'Dates written as dates',
  description:
    'The listed properties hold a date as YYYY-MM-DD. The fix rewrites 2026-9-5, 05.09.2026 and [[2026-09-05]].',
  severity: 'warning',
  params: [
    {
      name: 'properties',
      label: 'Properties',
      description: 'Comma-separated.',
      type: 'list',
      default: ['created', 'date', 'due', 'completed'],
    },
  ],
  enabledByDefault: false,
  source: 'builtin',
  check(note, params) {
    const fm = note.frontmatter ?? {}
    const out: LintFinding[] = []
    for (const key of list(params, 'properties')) {
      const value = fm[key]
      if (!filled(value)) continue
      const raw = typeof value === 'string' ? value : JSON.stringify(value)
      if (typeof value === 'string' && DATE.test(value) && asPlainDate(value)) continue
      const plain = typeof value === 'string' ? asPlainDate(value) : null
      out.push({
        message: `${key} is not a date written YYYY-MM-DD: ${raw}`,
        line: propertyLine(note, key),
        fixable: plain !== null,
      })
    }
    return out
  },
  fix(note, params) {
    const fm = note.frontmatter ?? {}
    let out = note.content
    for (const key of list(params, 'properties')) {
      const value = fm[key]
      if (typeof value !== 'string' || (DATE.test(value) && asPlainDate(value))) continue
      const plain = asPlainDate(value)
      if (plain) out = withProperty(out, key, plain)
    }
    return out === note.content ? null : out
  },
}

export const BUILTIN_RULES: LintRule[] = [
  frontmatterPresent,
  frontmatterValid,
  requiredProperties,
  noteType,
  noTags,
  forbiddenProperties,
  blankLineAfterFrontmatter,
  noH1,
  dateProperties,
]
