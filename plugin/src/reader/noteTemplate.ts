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
 * The quote and the comment may also be fields of their own: `{{ quote }}` is the callout, and
 * `{{ comment }}`, on a line of its own with whatever the body puts around it, is the comment. A
 * body with that field keeps the comment there, out of the callout, and a comment changed later
 * is written there again (`entryComment.ts`); without it the comment is inside the callout, as
 * `{{ highlight }}` has always had it.
 *
 * Everything here works on text, so the rules are tested without a vault.
 */
import dayjs from 'dayjs'
import { DATE_FORMAT } from '@/constants/dates'
import { parseTemplateVariables } from '@/templates/TemplateParser'
import { carryOf, commentLines, isBlankField, type EntryFrame } from './entryComment'

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
  /** The same callout, by the name a body with a comment field of its own calls it. */
  quote: string
  /** The comment alone, for a body that gives it a field of its own. */
  comment: string
}

const OPEN = /\{\{\s*#\s*body\s*\}\}\n?/
const CLOSE = /\n?\{\{\s*\/\s*body\s*\}\}\n?/
const VARIABLE = /\{\{\s*([^}]+?)\s*\}\}/g
const FILLS_IN = /\{\{[^}]*\}\}/
const HIGHLIGHT_LINE = /^\s*\{\{\s*(?:highlight|quote)\s*\}\}\s*$/
const HIGHLIGHT_VAR = /\{\{\s*(?:highlight|quote)\s*\}\}/
const COMMENT_VAR = /\{\{\s*comment\s*\}\}/

/** A template's text in its parts. */
export function parseNoteTemplate(text: string): NoteTemplate {
  const src = text.replace(/\r\n?/g, '\n')
  const open = OPEN.exec(src)
  if (!open) return { head: src, body: null, tail: '' }
  const afterOpen = src.slice(open.index + open[0].length)
  const close = CLOSE.exec(afterOpen)
  let body = close ? afterOpen.slice(0, close.index) : afterOpen
  if (!body.endsWith('\n')) body = `${body}\n`
  // A comment field needs the callout on a line of its own to be found by: at the end, if unsaid.
  if (COMMENT_VAR.test(body) && !body.split('\n').some((l) => HIGHLIGHT_LINE.test(l)))
    body = `${body}{{ quote }}\n`
  return {
    head: src.slice(0, open.index),
    body: withRoomAfterHighlight(body),
    tail: close ? afterOpen.slice(close.index + close[0].length) : '',
  }
}

/**
 * A body with a blank line after the highlight: a line right after a callout would be read as
 * part of its quote. A quoted line right before it gets one too, or the callout would be read as
 * part of that quote.
 */
function withRoomAfterHighlight(body: string): string {
  const lines = body.split('\n')
  const at = lines.findIndex((l) => HIGHLIGHT_LINE.test(l))
  if (at >= 0 && at + 1 < lines.length - 1 && lines[at + 1].trim()) lines.splice(at + 1, 0, '')
  if (at > 0 && /^\s*>/.test(lines[at - 1])) lines.splice(at, 0, '')
  return lines.join('\n')
}

/** The line of a body its comment field is on, and what is written before and after it there. */
function commentSlotOf(lines: string[]): { at: number; lead: string; end: string } | null {
  if (!lines.some((l) => HIGHLIGHT_LINE.test(l))) return null
  const at = lines.findIndex((l) => COMMENT_VAR.test(l) && !HIGHLIGHT_VAR.test(l))
  if (at < 0) return null
  const m = COMMENT_VAR.exec(lines[at])!
  return {
    at,
    lead: lines[at].slice(0, m.index),
    end: lines[at].slice(m.index + m[0].length),
  }
}

/** Whether the template gives the comment a field of its own, outside the callout. */
export function hasCommentField(template: NoteTemplate | null): boolean {
  return template?.body != null && commentSlotOf(template.body.split('\n')) != null
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
  const lines = body.split('\n')
  const slot = commentSlotOf(lines)
  const rendered = lines.map((line, i) => {
    if (i !== slot?.at) return renderTemplate(line, vars)
    const lead = renderTemplate(slot.lead, vars)
    const field = commentLines(vars.comment, lead, carryOf(lead), renderTemplate(slot.end, vars))
    // An empty field as the body's first line would only leave a blank line before the entry.
    return i === 0 && isBlankField(field) ? null : field.join('\n')
  })
  const text = rendered
    .filter((l) => l !== null)
    .join('\n')
    .replace(/\n+$/, '')
  return HIGHLIGHT_VAR.test(body) ? text : `${text}\n${vars.highlight}`
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
  const frame: EntryFrame = {
    before: lines.slice(0, at).map((l) => new RegExp(`^${patternOf(l)}$`)),
    after: lines.slice(at + 1).map((l) => new RegExp(`^${patternOf(l)}$`)),
  }
  const slot = commentSlotOf(lines)
  if (!slot) return frame
  const lead = slot.lead.trimEnd()
  const end = slot.end.trim()
  return {
    ...frame,
    comment: {
      side: slot.at < at ? 'before' : 'after',
      index: slot.at < at ? slot.at : slot.at - at - 1,
      lead: new RegExp(`${patternOf(lead)}${lead !== slot.lead ? '[ \\t]*' : ''}`),
      end: new RegExp(end ? `[ \\t]*${patternOf(end)}` : ''),
      pad: slot.lead.slice(lead.length),
      written: {
        lead: FILLS_IN.test(slot.lead) ? '' : slot.lead,
        end: FILLS_IN.test(slot.end) ? '' : slot.end,
      },
    },
  }
}

/** A line of the template as a pattern: as written, whatever it fills in being anything. */
const patternOf = (line: string): string =>
  line
    .split(VARIABLE)
    .map((part, i) => (i % 2 ? '.*?' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('')
