/**
 * A highlight's entry in a note made from a template: the callout, the lines the template's body
 * wrote around it, and — when the body has a `{{ comment }}` field of its own — the comment, found
 * where the body put it rather than inside the callout.
 *
 * The body is known as a frame (`entryFrame` in `noteTemplate.ts`): a pattern for each line before
 * the callout and after it, the comment's line among them as a slot. The slot's text before
 * `{{ comment }}` is its lead (`**Comment:** `, `> `), the text after it its end. A comment of
 * several lines carries on on lines of its own, each with the lead's quote marks, if it has any;
 * without them, a blank line would end it, so its blank lines are left out.
 *
 * Where the comment is the body's first or last line, nothing after it in the body says where it
 * ends: it is the lines that carry on from the lead, and an empty one may not be there at all.
 *
 * Everything here works on the note's text, so the rules are tested without a vault.
 */

/** Where a body has its `{{ comment }}`, as a slot in its frame. */
export interface CommentSlot {
  /** Before the callout or after it, and the index of its line in that side's patterns. */
  side: 'before' | 'after'
  index: number
  /** The text before `{{ comment }}` on its line, and after it, as patterns. */
  lead: RegExp
  end: RegExp
  /** The space the body writes after the lead, kept when an empty field has lost it. */
  pad: string
  /** The lead and end as written, for a field no longer in the note; empty when they fill in. */
  written: { lead: string; end: string }
}

/**
 * Where a body has its `{{ forms }}`: a line of the frame like any other, its pattern capturing
 * the forms, since they are always one line.
 */
export interface FormsSlot {
  side: 'before' | 'after'
  index: number
  /** The line's pattern, the forms its first group. */
  pattern: RegExp
  /** The space the body writes after the lead, kept when the field is filled in again. */
  pad: string
}

/** The lines a template's body writes around a highlight, as `entryFrame` gives them. */
export interface EntryFrame {
  before: RegExp[]
  after: RegExp[]
  comment?: CommentSlot
  forms?: FormsSlot
}

/** A comment's lines in a note: `[from, to)`, the text in them, and how they are written. */
export interface CommentRegion {
  from: number
  to: number
  text: string
  /** The lead as the note has it, and what goes before each line after the first. */
  lead: string
  carry: string
  end: string
  /** The body's first or last line, where an empty field leaves no line. */
  edge: boolean
}

/** An entry's lines, `[start, end)`, and its comment's, when it has its field. */
export interface EntryMatch {
  start: number
  end: number
  comment?: CommentRegion
}

/** The quote marks (and the indent before them) that a line of several must carry on with. */
export const carryOf = (lead: string): string => /^[ \t]*(?:>[ \t]?)*/.exec(lead)?.[0] ?? ''

/** A comment as the lines of its field, written with `lead`, `carry` and `end`. */
export function commentLines(text: string, lead: string, carry: string, end: string): string[] {
  const quoted = carry.trim() !== ''
  const lines = text
    .replace(/\r\n?/g, '\n')
    .trim()
    .split('\n')
    .filter((l) => quoted || l.trim())
  if (!lines.length || (lines.length === 1 && !lines[0])) return [`${lead}${end}`.trimEnd()]
  return lines.map((l, i) =>
    `${i ? (l.trim() ? carry : carry.trimEnd()) : lead}${l}${i === lines.length - 1 ? end : ''}`.trimEnd()
  )
}

/** Whether a comment written into its field leaves no line at all: a bare slot, nothing in it. */
export const isBlankField = (lines: string[]): boolean => lines.length === 1 && !lines[0].trim()

/**
 * The comment in `lines` taken as its field, or null when they are not one: the first line must
 * read as the lead, each after it carry on, and the last end as the slot does.
 */
function readRegion(
  slot: CommentSlot,
  lines: string[]
): Omit<CommentRegion, 'from' | 'to' | 'edge'> | null {
  if (!lines.length) return null
  const first = new RegExp(`^(${slot.lead.source})(.*)$`).exec(lines[0])
  if (!first) return null
  const lead = `${first[1].trimEnd()}${slot.pad}`
  const carry = carryOf(lead)
  const quoted = carry.trim() !== ''
  const texts = [first[2]]
  for (const line of lines.slice(1)) {
    if (quoted) {
      if (!line.startsWith(carry.trimEnd())) return null
      texts.push(
        line.startsWith(carry) ? line.slice(carry.length) : line.slice(carry.trimEnd().length)
      )
    } else {
      if (!line.trim() || /^\s*>/.test(line)) return null
      texts.push(line.slice(carry.length))
    }
  }
  let end = ''
  if (slot.end.source !== '(?:)') {
    const last = texts.length - 1
    const m = new RegExp(`(${slot.end.source})\\s*$`).exec(texts[last])
    if (!m) return null
    end = m[1]
    texts[last] = texts[last].slice(0, m.index)
  }
  if (!quoted && lines.length > 1 && !texts[0].trim()) return null
  return { text: texts.join('\n').trim(), lead, carry, end }
}

const fits = (lines: string[], from: number, patterns: RegExp[]): boolean =>
  from >= 0 &&
  from + patterns.length <= lines.length &&
  patterns.every((p, i) => p.test(lines[from + i]))

/** Whether a line cannot be a comment's: a callout or quote, when the field is not one. */
const foreign = (line: string): boolean => /^\s*>/.test(line)

/**
 * The entry around the callout at `[start, end)` of `lines`, when what is around it still reads as
 * the frame; null when it does not. `floor` and `ceiling` are how far it may reach: the callouts
 * before and after it.
 */
export function matchEntry(
  lines: string[],
  start: number,
  end: number,
  frame: EntryFrame,
  floor = 0,
  ceiling = lines.length
): EntryMatch | null {
  const slot = frame.comment
  if (!slot) {
    if (!(frame.before.length || frame.after.length)) return null
    return fits(lines, start - frame.before.length, frame.before) &&
      fits(lines, end, frame.after) &&
      start - frame.before.length >= floor &&
      end + frame.after.length <= ceiling
      ? { start: start - frame.before.length, end: end + frame.after.length }
      : null
  }
  const side = slot.side === 'after' ? frame.after : frame.before
  const near = slot.side === 'after' ? side.slice(0, slot.index) : side.slice(slot.index + 1)
  const far = slot.side === 'after' ? side.slice(slot.index + 1) : side.slice(0, slot.index)
  const other = slot.side === 'after' ? frame.before : frame.after
  if (slot.side === 'after') {
    if (!fits(lines, start - other.length, other) || start - other.length < floor) return null
    if (!fits(lines, end, near)) return null
  } else {
    if (!fits(lines, end, other) || end + other.length > ceiling) return null
    if (!fits(lines, start - near.length, near)) return null
  }
  // The slot's lines run from `edge` away from the callout.
  const edge = slot.side === 'after' ? end + near.length : start - near.length
  const room = slot.side === 'after' ? ceiling - edge : edge - floor
  const take = (m: number): Omit<CommentRegion, 'from' | 'to' | 'edge'> | null =>
    slot.side === 'after'
      ? readRegion(slot, lines.slice(edge, edge + m))
      : readRegion(slot, lines.slice(edge - m, edge))
  const at = (m: number): EntryMatch => {
    const { written } = slot
    const region = take(m) ?? { text: '', ...written, carry: carryOf(written.lead) }
    const from = slot.side === 'after' ? edge : edge - m
    const comment = { ...region, from, to: from + m, edge: !far.length }
    return slot.side === 'after'
      ? { start: start - other.length, end: edge + m + far.length, comment }
      : { start: edge - m - far.length, end: end + other.length, comment }
  }
  if (far.length) {
    // Something of the body beyond it says where it ends: the fewest lines that let it fit.
    for (let m = 1; m + far.length <= room; m++) {
      if (!take(m)) continue
      const beyond = slot.side === 'after' ? edge + m : edge - m - far.length
      if (fits(lines, beyond, far)) return at(m)
    }
    return null
  }
  // The body's first or last line: the lines that carry on from its lead, if any.
  let best = 0
  for (let m = 1; m <= room; m++) {
    const line = slot.side === 'after' ? lines[edge + m - 1] : lines[edge - m]
    if (!line.trim()) break
    if (take(m)) best = m
    else if (slot.side === 'after' || foreign(line)) break
  }
  return at(best)
}

/**
 * The line of an entry its forms are on, when the frame has a field for them: counted from the
 * entry's start, or from the callout's end (`calloutEnd`) for a field after it, the comment's
 * lines on the same side taken into account.
 */
export function formsLineOf(entry: EntryMatch, calloutEnd: number, frame: EntryFrame): number | null {
  const slot = frame.forms
  if (!slot) return null
  const c = frame.comment
  const m = entry.comment ? entry.comment.to - entry.comment.from : 1
  const shift = c && c.side === slot.side && c.index < slot.index ? m - 1 : 0
  return (slot.side === 'before' ? entry.start : calloutEnd) + slot.index + shift
}

/** The forms written on an entry's line, as the field has them; null when it is not the field. */
export function formsOnLine(line: string | undefined, frame: EntryFrame): string | null {
  const m = frame.forms && line !== undefined ? frame.forms.pattern.exec(line) : null
  return m ? (m[1] ?? '') : null
}

/**
 * The entry's forms line with `forms` in its field: the line as written with only what is in the
 * field replaced, and the lead's space put back when it had lost it.
 */
export function withForms(line: string, forms: string, frame: EntryFrame): string {
  const slot = frame.forms
  const m = slot ? new RegExp(slot.pattern.source, 'd').exec(line) : null
  const at = m?.indices?.[1]
  if (!slot || !at) return line
  let lead = line.slice(0, at[0])
  if (forms && slot.pad && !/\s$/.test(lead)) lead += slot.pad
  return `${lead}${forms}${line.slice(at[1])}`.trimEnd()
}
