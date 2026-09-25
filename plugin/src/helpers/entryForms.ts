/**
 * What the task and transaction dialogs read from a note and write back to it.
 *
 * Both kinds of note keep their title as the first line of the text and their description as
 * the rest; everything else is properties. A form edits those and nothing more: saving an
 * existing note rewrites its text and the properties the form shows, and leaves every other
 * property exactly as it found it — labels, priority, whatever a script put there.
 */
import dayjs from 'dayjs'
import { DATE_FORMAT } from '@/constants/dates'
import type { TaskCreateDTO } from '@/entities/Task'
import type { TransactionCreateDTO } from '@/entities/Transaction'

export const DEFAULT_TASK_TITLE = 'New Task'
export const DEFAULT_TRANSACTION_TITLE = 'New Transaction'

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/

/** The first line with text in it, and everything under it. */
export function splitNoteBody(body: string): { title: string; description: string } {
  const lines = body.split('\n')
  const at = lines.findIndex((line) => line.trim() !== '')
  if (at === -1) return { title: '', description: '' }
  return {
    title: lines[at].trim(),
    description: lines
      .slice(at + 1)
      .join('\n')
      .replace(/^(\s*\n)+/, '')
      .trimEnd(),
  }
}

/** The text of a note with this title and description. */
export function joinNoteBody(title: string, description: string): string {
  const head = title.trim()
  const rest = description.trimEnd()
  if (!head && !rest) return ''
  return rest.trim() ? `${head}\n${rest}\n` : `${head}\n`
}

/** The note with its text replaced and its frontmatter block left byte for byte. */
export function replaceNoteBody(raw: string, body: string): string {
  const match = FRONTMATTER.exec(raw)
  if (!match) return body
  const head = match[0].endsWith('\n') ? match[0] : `${match[0]}\n`
  return head + body
}

export type FrontmatterPatch = Record<string, unknown>

/** Writes a patch into frontmatter: a value is set, `null` removes the property. */
export function applyFrontmatterPatch(fm: Record<string, unknown>, patch: FrontmatterPatch): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete fm[key]
    else fm[key] = value
  }
}

// ── Tasks ──

export interface TaskFormValues {
  title: string
  description: string
  /** `YYYY-MM-DD`, or null for none. */
  date: string | null
  /** `HH:mm`, or null for none. */
  time: string | null
  due: string | null
  dueTime: string | null
  recurrence: string | null
}

export function emptyTaskValues(): TaskFormValues {
  return {
    title: '',
    description: '',
    date: null,
    time: null,
    due: null,
    dueTime: null,
    recurrence: null,
  }
}

/** The properties a task form owns, as the task note writes them. */
export function taskFrontmatterPatch(values: TaskFormValues): FrontmatterPatch {
  return {
    date: values.date || null,
    dateTime: values.date && values.time ? values.time : null,
    due: values.due || null,
    dueTime: values.due && values.dueTime ? values.dueTime : null,
    recurrence: values.recurrence?.trim() || null,
  }
}

function withTime(date: string | null, time: string | null): dayjs.Dayjs | undefined {
  if (!date) return undefined
  const day = dayjs(date)
  if (!time) return day
  const [h, m] = time.split(':').map((n) => parseInt(n, 10))
  return day.hour(h).minute(m)
}

/** What `createTask` needs to write a new task from the form. */
export function taskValuesToCreateDTO(values: TaskFormValues): TaskCreateDTO {
  const title = values.title.trim()
  const date = withTime(values.date, values.time)
  const due = withTime(values.due, values.dueTime)
  return {
    title: title || DEFAULT_TASK_TITLE,
    description: values.description,
    content: joinNoteBody(title, values.description),
    date,
    dateTime: values.time && date ? date : undefined,
    due,
    dueTime: values.dueTime && due ? due : undefined,
    recurrence: values.recurrence?.trim() || undefined,
  }
}

// ── Transactions ──

export interface TransactionFormValues {
  title: string
  description: string
  /** `YYYY-MM-DD`. */
  date: string
  /** Wikilinks, `[[Account]]`, or null for none. */
  from: string | null
  to: string | null
  amount: number | null
  currency: string | null
  foreignAmount: number | null
  foreignCurrency: string | null
  category: string | null
  groups: string[]
}

export function emptyTransactionValues(date = dayjs()): TransactionFormValues {
  return {
    title: '',
    description: '',
    date: date.format(DATE_FORMAT),
    from: null,
    to: null,
    amount: null,
    currency: null,
    foreignAmount: null,
    foreignCurrency: null,
    category: null,
    groups: [],
  }
}

/** The properties a transaction form owns; an empty one is removed rather than left blank. */
export function transactionFrontmatterPatch(values: TransactionFormValues): FrontmatterPatch {
  const hasForeign = !!values.foreignCurrency && values.foreignAmount != null
  return {
    date: values.date,
    from: values.from || null,
    to: values.to || null,
    amount: values.amount,
    currency: values.currency || null,
    foreignAmount: hasForeign ? values.foreignAmount : null,
    foreignCurrency: hasForeign ? values.foreignCurrency : null,
    category: values.category || null,
    groups: values.groups.length ? [...values.groups] : null,
  }
}

/** What `createTransaction` needs to write a new transaction from the form. */
export function transactionValuesToCreateDTO(values: TransactionFormValues): TransactionCreateDTO {
  const title = values.title.trim()
  const hasForeign = !!values.foreignCurrency && values.foreignAmount != null
  return {
    title: title || DEFAULT_TRANSACTION_TITLE,
    description: values.description,
    content: joinNoteBody(title, values.description) || undefined,
    date: dayjs(values.date),
    from: values.from || undefined,
    to: values.to || undefined,
    amount: values.amount ?? undefined,
    currency: values.currency || undefined,
    foreignAmount: hasForeign ? values.foreignAmount : undefined,
    foreignCurrency: hasForeign ? values.foreignCurrency : undefined,
    category: values.category || undefined,
    groups: values.groups.length ? [...values.groups] : undefined,
  }
}
