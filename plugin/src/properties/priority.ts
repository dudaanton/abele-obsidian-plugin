/**
 * A priority property, on the scale tasks use (`helpers/taskMeta`): `low`, `medium`, `high`, and
 * no priority below `low`. Raising an empty one gives `low`; lowering `low` empties it. The value
 * is written the way tasks read it best, in lower case.
 *
 * What is not on the scale is not this widget's value: the row is left to Obsidian.
 */
import { parsePriority, TASK_PRIORITIES, type TaskPriority } from '@/helpers/taskMeta'

const isEmpty = (value: unknown) =>
  value == null ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0)

/** The level a value holds: 0 for none, 1 to 3 from `low` to `high`, null when off the scale. */
export function priorityLevel(value: unknown): number | null {
  if (isEmpty(value)) return 0
  const priority = parsePriority(value)
  return priority ? TASK_PRIORITIES.indexOf(priority) + 1 : null
}

/** The value a level stands for: null for none. */
export function priorityAt(level: number): TaskPriority | null {
  return level >= 1 && level <= TASK_PRIORITIES.length ? TASK_PRIORITIES[level - 1] : null
}

/**
 * The value one step up (`delta` 1) or down (-1), `undefined` when there is nowhere to go — `high`
 * raised, nothing lowered — or when the value is not a priority.
 */
export function stepPriority(value: unknown, delta: number): TaskPriority | null | undefined {
  const level = priorityLevel(value)
  if (level === null) return undefined
  const next = Math.min(TASK_PRIORITIES.length, Math.max(0, level + delta))
  return next === level ? undefined : priorityAt(next)
}

/** How a level is named on screen. */
export function priorityName(level: number): string {
  const priority = priorityAt(level)
  return priority ? priority[0].toUpperCase() + priority.slice(1) : 'None'
}

/** The theme colour of a level, as tasks mark it: blue, orange, red. */
export const PRIORITY_COLORS: Record<TaskPriority, 'blue' | 'orange' | 'red'> = {
  low: 'blue',
  medium: 'orange',
  high: 'red',
}
