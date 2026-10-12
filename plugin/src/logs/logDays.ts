/**
 * A note's logs laid out by day, for the calendar they can be read in: which days have an entry,
 * and, for a log kept as a checkbox, whether that day's box is ticked.
 */

/** What a day of the calendar shows: an entry, or a checkbox ticked or left open. */
export type LogDayMark = 'entry' | 'done' | 'open'

/** The part of a log a day needs: when it was written and what it says about the note. */
export interface LogLike {
  createdAt: { format(pattern: string): string } | null
  content?: string
}

const CHECKBOX = /^\s*(?:[-*+]|\d+[.)])\s+\[(.)\]/

/**
 * Whether a log is a checkbox, and ticked: «done» when every box in it is ticked, «open» when any
 * is left, null for an entry of words. Any mark but a space ticks a box, as Obsidian draws it.
 */
export function logCheck(content: string | undefined): 'done' | 'open' | null {
  if (!content) return null
  const boxes = content
    .split('\n')
    .map((line) => CHECKBOX.exec(line)?.[1])
    .filter((mark): mark is string => mark !== undefined)
  if (!boxes.length) return null
  return boxes.every((mark) => mark !== ' ') ? 'done' : 'open'
}

/** One day's mark from the logs written on it: an open box outweighs a ticked one. */
export function dayMark(logs: LogLike[]): LogDayMark | null {
  if (!logs.length) return null
  const checks = logs.map((log) => logCheck(log.content))
  if (checks.includes('open')) return 'open'
  if (checks.includes('done')) return 'done'
  return 'entry'
}

/** The logs by day (`YYYY-MM-DD`), newest written first within a day. */
export function logsByDay<T extends LogLike>(logs: T[], format = 'YYYY-MM-DD'): Map<string, T[]> {
  const days = new Map<string, T[]>()
  for (const log of logs) {
    if (!log.createdAt) continue
    const key = log.createdAt.format(format)
    days.set(key, [...(days.get(key) ?? []), log])
  }
  return days
}
