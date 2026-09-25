/**
 * A template for the note highlights go to. It is an ordinary note, written in the plugin's
 * template language (`{{ title }}`, `{{ date }}`, `{{ date.format('D MMMM') }}`), with one part
 * marked as its body, the way a Mustache section is:
 *
 * ```markdown
 * ---
 * tags: [reading]
 * ---
 * # {{ title }}
 *
 * {{#body}}
 * ## {{ chapter }} · {{ date }}
 * {{ highlight }}
 * {{/body}}
 * ```
 *
 * The first highlight makes the note from the whole template, the body written for it where the
 * body stands. Each highlight after that adds only the body, at the end of the note. `{{ highlight }}`
 * is the highlight itself, the callout the reader reads back; a body that does not say where it
 * goes gets it at its end, and a template with no body gets each highlight at the end of the note.
 *
 * Everything here works on text, so the rules are tested without a vault.
 */
import dayjs from 'dayjs'
import { DATE_FORMAT } from '@/constants/dates'
import { parseTemplateVariables } from '@/templates/TemplateParser'
import type { EntryFrame } from './highlights'

export interface NoteTemplate {
  /** What comes before the body: written once, when the note is made. */
  head: string
  /** The part written for each highlight; null when the template marks none. */
  body: string | null
  /** What comes after the body: written once, after the first highlight. */
  tail: string
}

/** What a template can say about a book and a highlight. */
export interface NoteVars {
  /** The book's title, and its author. */
  title: string
  author: string
  /** A link to the book file. */
  book: string
  /** The chapter or page the highlight is in. */
  chapter: string
  color: string
  /** A link to the highlight's place. */
  link: string
  /** The highlight, as the callout the reader reads back. */
  highlight: string
}

const OPEN = /\{\{\s*#\s*body\s*\}\}\n?/
const CLOSE = /\n?\{\{\s*\/\s*body\s*\}\}\n?/
const VARIABLE = /\{\{\s*([^}]+?)\s*\}\}/g
const HIGHLIGHT_LINE = /^\s*\{\{\s*highlight\s*\}\}\s*$/

/** A template's text in its parts. */
export function parseNoteTemplate(text: string): NoteTemplate {
  const src = text.replace(/\r\n?/g, '\n')
  const open = OPEN.exec(src)
  if (!open) return { head: src, body: null, tail: '' }
  const afterOpen = src.slice(open.index + open[0].length)
  const close = CLOSE.exec(afterOpen)
  const body = close ? afterOpen.slice(0, close.index) : afterOpen
  return {
    head: src.slice(0, open.index),
    body: withRoomAfterHighlight(body.endsWith('\n') ? body : `${body}\n`),
    tail: close ? afterOpen.slice(close.index + close[0].length) : '',
  }
}

/**
 * A body with a blank line after the highlight: a line right after a callout would be read as
 * part of its quote.
 */
function withRoomAfterHighlight(body: string): string {
  const lines = body.split('\n')
  const at = lines.findIndex((l) => HIGHLIGHT_LINE.test(l))
  if (at >= 0 && at + 1 < lines.length - 1 && lines[at + 1].trim()) lines.splice(at + 1, 0, '')
  return lines.join('\n')
}

/**
 * The text with what the template names filled in, in one pass: a value put in is never read as a
 * template again, so the words of a book cannot be. Dates are as in the plugin's other templates;
 * a name it does not know is left as written.
 */
export function renderTemplate(text: string, vars: Partial<NoteVars>): string {
  return text.replace(VARIABLE, (raw, expr: string) => {
    const name = expr.trim()
    if (Object.hasOwn(vars, name)) return (vars as Record<string, string>)[name] ?? ''
    const [variable] = parseTemplateVariables(raw).variables
    if (variable?.type !== 'date') return raw
    return dayjs()
      .add(variable.offset ?? 0, 'day')
      .format(variable.format || DATE_FORMAT)
  })
}

/** The body for one highlight: the body as the template has it, the highlight in it. */
function renderBody(body: string, vars: NoteVars): string {
  const text = renderTemplate(body, vars).replace(/\n+$/, '')
  return /\{\{\s*highlight\s*\}\}/.test(body) ? text : `${text}\n${vars.highlight}`
}

/** What one highlight adds to a note that is there already. */
export function entryFrom(template: NoteTemplate | null, vars: NoteVars): string {
  return template?.body != null ? renderBody(template.body, vars) : vars.highlight
}

/** A new note, made from the whole template for its first highlight. */
export function newNoteFrom(template: NoteTemplate, vars: NoteVars): string {
  if (template.body == null) {
    const head = renderTemplate(template.head, vars).replace(/\s+$/, '')
    return `${head ? `${head}\n\n` : ''}${vars.highlight}\n`
  }
  const head = renderTemplate(template.head, vars)
  const tail = renderTemplate(template.tail, vars)
  return `${head}${renderBody(template.body, vars)}\n${tail}`
}

/**
 * The lines the body writes around the highlight, as patterns: removing a highlight takes them
 * too while they still read as the template wrote them. Empty when the highlight does not stand
 * on a line of its own in the body.
 */
export function entryFrame(template: NoteTemplate): EntryFrame {
  const none: EntryFrame = { before: [], after: [] }
  if (template.body == null) return none
  const lines = template.body.replace(/\n+$/, '').split('\n')
  const at = lines.findIndex((l) => HIGHLIGHT_LINE.test(l))
  if (at < 0) return none
  const pattern = (line: string) =>
    new RegExp(
      `^${line
        .split(VARIABLE)
        .map((part, i) => (i % 2 ? '.*' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        .join('')}$`
    )
  return { before: lines.slice(0, at).map(pattern), after: lines.slice(at + 1).map(pattern) }
}
