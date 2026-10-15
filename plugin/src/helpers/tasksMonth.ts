/**
 * A note's calendar tasks laid out as a month: what stands on each day, the mark under the day,
 * and which day the month opens on and moves to as it is turned. Pure, so the month and its tests
 * read the same answer.
 */
import type { LogDayMark } from '@/logs/logDays'

/** The part of a task a day needs. */
export interface MonthTask {
  id: string
  dates: string[]
  completedAt?: unknown
  /** Seconds, for the order within a day. */
  getSortTimestamp(): number
}

/** The part of a calendar event a day needs. */
export interface MonthEvent {
  event: { id: string; allDay: boolean; start: number }
}

/** One row of a day: a task, or an event of an external calendar. */
export interface MonthItem<T extends MonthTask, E extends MonthEvent> {
  key: string
  /** Milliseconds, for the order within the day. */
  at: number
  task?: T
  shown?: E
}

/** Day (`YYYY-MM-DD`) → its tasks and events, in the order of the day as the list draws them. */
export function monthDays<T extends MonthTask, E extends MonthEvent>(
  tasks: readonly T[],
  events: ReadonlyMap<string, readonly E[]> | undefined,
  startOfDay: (day: string) => number
): Map<string, MonthItem<T, E>[]> {
  const map = new Map<string, MonthItem<T, E>[]>()
  const of = (day: string) => {
    let items = map.get(day)
    if (!items) map.set(day, (items = []))
    return items
  }
  for (const task of tasks)
    for (const day of task.dates)
      of(day).push({ key: `task:${task.id}`, task, at: task.getSortTimestamp() * 1000 })
  for (const [day, shown] of events ?? [])
    for (const item of shown)
      of(day).push({
        key: `event:${item.event.id}`,
        shown: item,
        // A day-long event heads its day; a timed one that began earlier is there from its start.
        at: item.event.allDay ? 0 : Math.max(item.event.start, startOfDay(day)),
      })
  for (const items of map.values()) items.sort((a, b) => a.at - b.at)
  return map
}

/**
 * The mark under each day: a ticked box when every task of the day is done, an open one while
 * one is not, a dot where only events stand. The same codes the logs' month uses.
 */
export function monthMarks(
  days: ReadonlyMap<string, readonly { task?: MonthTask }[]>
): Map<string, LogDayMark> {
  const marks = new Map<string, LogDayMark>()
  for (const [day, items] of days) {
    const tasks = items.filter((item) => item.task)
    if (!items.length) continue
    marks.set(
      day,
      !tasks.length ? 'entry' : tasks.every((item) => item.task?.completedAt) ? 'done' : 'open'
    )
  }
  return marks
}

/** The month opens on today when something is planned today, else the next planned day, else the last. */
export function openingDay(days: Iterable<string>, today: string): string {
  const keys = [...days].sort()
  return keys.find((key) => key >= today) ?? keys.at(-1) ?? today
}

/**
 * The chosen day once the month is turned to `month` (`YYYY-MM`): kept when it is in that month;
 * else the month's first planned day, else today when today is in it, else the month's first day.
 */
export function dayInMonth(
  days: Iterable<string>,
  month: string,
  chosen: string,
  today: string
): string {
  if (chosen.startsWith(month)) return chosen
  const planned = [...days].filter((key) => key.startsWith(month)).sort()[0]
  if (planned) return planned
  return today.startsWith(month) ? today : `${month}-01`
}
