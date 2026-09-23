import { isWikilink } from '@/helpers/pathsHelpers'
import { isKitColor, type KitColor } from '@/constants/colors'

/**
 * Priority and labels of a task, read from its frontmatter.
 *
 * Both are written by hand in a note's properties, so both are read forgivingly: whatever
 * someone typed, in whatever case, as a single value or a list. Anything that cannot be read
 * is treated as absent rather than as an error — a task with a typo in its priority is still a
 * task, and it shows up exactly as one with no priority at all.
 */

export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

/** The frontmatter property priority is read from. Fixed, unlike the label property. */
export const PRIORITY_PROPERTY = 'priority'

/** The label property used until someone picks another. */
export const DEFAULT_LABEL_PROPERTY = 'labels'

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 3, medium: 2, low: 1 }

/** `High`, ` medium `, `[low]` — all read. Anything else is no priority. */
export function parsePriority(value: unknown): TaskPriority | null {
  const first = Array.isArray(value) ? value[0] : value
  if (typeof first !== 'string') return null
  const normalized = first.trim().toLowerCase()
  return (TASK_PRIORITIES as readonly string[]).includes(normalized)
    ? (normalized as TaskPriority)
    : null
}

/** Higher sorts first; a task without a priority ranks below `low`. */
export function priorityRank(priority: TaskPriority | null): number {
  return priority ? PRIORITY_RANK[priority] : 0
}

/** One value of a label property, as it is shown. `null` when there is nothing to show. */
function labelText(value: unknown): string | null {
  // An unquoted `- [[Work]]` in YAML is a list inside a list, not a string. Obsidian's own
  // property editor quotes it, but a hand-written note may not.
  if (Array.isArray(value)) return value.length === 1 ? labelText(value[0]) : null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value !== 'string') return null

  let text = value.trim()
  if (isWikilink(text)) text = wikilinkLabel(text)
  text = text.replace(/^#+/, '').trim()
  return text.length > 0 ? text : null
}

/** `[[Area/Work|Job]]` reads as `Job`, `[[Area/Work#Plan]]` as `Work`. */
function wikilinkLabel(link: string): string {
  const inner = link.match(/\[\[([^\]]+)\]\]/)?.[1] ?? ''
  const [target, alias] = inner.split('|')
  if (alias?.trim()) return alias.trim()
  const name = target.split('#')[0].split('/').pop() ?? ''
  return name.replace(/\.md$/, '').trim()
}

/** The key two spellings of one label share. */
export const labelKey = (label: string): string => label.trim().toLowerCase()

/**
 * Labels of a task from its label property.
 *
 * A string is one label — a comma is part of it, not a separator, since Obsidian's list
 * properties are how several values are written. A list gives one label per entry. Duplicates
 * that differ only in case collapse into the first spelling met.
 */
export function parseLabels(value: unknown): string[] {
  if (value === null || value === undefined) return []
  const entries = Array.isArray(value) ? value : [value]

  const seen = new Set<string>()
  const labels: string[] = []
  for (const entry of entries) {
    const text = labelText(entry)
    if (!text) continue
    const key = labelKey(text)
    if (seen.has(key)) continue
    seen.add(key)
    labels.push(text)
  }
  return labels
}

export interface LabelColor {
  value: string
  color: KitColor
}

/** The colour configured for a label, matched case-insensitively. Grey when none is. */
export function labelColor(label: string, colors: LabelColor[] | undefined): KitColor {
  const key = labelKey(label)
  const found = colors?.find((entry) => labelKey(entry.value) === key)
  return found && isKitColor(found.color) ? found.color : 'grey'
}

/**
 * Stable sort by priority, highest first. Tasks of the same priority keep the order they came
 * in, which is how the list's existing order survives underneath.
 */
export function sortByPriority<T extends { priority: TaskPriority | null }>(tasks: T[]): T[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort(
      (a, b) => priorityRank(b.task.priority) - priorityRank(a.task.priority) || a.index - b.index
    )
    .map(({ task }) => task)
}
