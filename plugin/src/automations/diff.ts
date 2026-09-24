import type { EventKind, Frontmatter } from './types'

/**
 * What a change to a note amounts to, worked out from its frontmatter before and after.
 *
 * Pure on purpose: the bus that feeds this sits on Obsidian's events, and this is the part
 * that decides what a person would call what happened — so it is the part worth testing
 * without an Obsidian.
 */

/** The properties Abele reads a task's dates from. */
const TASK_DATE_KEYS = ['date', 'dateTime', 'due', 'dueTime']

/** Filled in, the way a person reads a property: an empty string or list is not. */
function filled(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  return true
}

const isTask = (fm: Frontmatter | null): boolean => fm?.type === 'task'

/** Equal as values: YAML gives back fresh objects on every parse. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  return JSON.stringify(a) === JSON.stringify(b)
}

/** The properties that differ between the two, added and removed ones included. */
export function changedKeys(before: Frontmatter | null, after: Frontmatter | null): string[] {
  const a = before ?? {}
  const b = after ?? {}
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].filter((key) => !same(a[key], b[key]))
}

export interface ChangeShape {
  created?: boolean
  deleted?: boolean
  renamed?: boolean
  before: Frontmatter | null
  after: Frontmatter | null
}

/**
 * Every event one change is.
 *
 * A task is created when a note is made as one, or when a note that was not one becomes one —
 * a note created empty and given its type afterwards is the same thing to the person. A task
 * made already completed was created, not completed: nothing was ticked.
 */
export function kindsFor(change: ChangeShape): EventKind[] {
  const { before, after } = change

  if (change.deleted) return ['note.deleted']
  if (change.renamed) return ['note.renamed']
  if (change.created) return isTask(after) ? ['task.created', 'note.created'] : ['note.created']

  const kinds: EventKind[] = []
  if (isTask(after)) {
    if (!isTask(before)) {
      kinds.push('task.created')
    } else {
      const was = filled(before?.completed)
      const now = filled(after?.completed)
      if (!was && now) kinds.push('task.completed')
      if (was && !now) kinds.push('task.reopened')
      if (TASK_DATE_KEYS.some((key) => !same(before?.[key], after?.[key]))) {
        kinds.push('task.date-changed')
      }
      kinds.push('task.changed')
    }
  }
  kinds.push('note.changed')
  return kinds
}

/** The text below the frontmatter. */
export function bodyOf(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content)
  return match ? content.slice(match[0].length) : content
}

/** A cheap fingerprint of a body, to tell whether it changed without keeping it. */
export function fingerprint(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  return `${text.length}:${hash}`
}
