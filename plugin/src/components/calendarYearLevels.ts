import { heatLevel } from '@/bases/calendarLayout'
import type { LogDayMark } from '@/logs/logDays'

/**
 * How a small calendar's year view tints a day, by `YYYY-MM-DD`: 1–4 the accent's strengths, as
 * the base calendar's year reads, or `open` for a box still to tick, drawn as an outline. A day
 * left out has nothing on it.
 */
export type YearLevel = 1 | 2 | 3 | 4 | 'open'

/** A note's footer month: a ticked day in full, words written half, a box still open outlined. */
export function levelsOfMarks(marks: ReadonlyMap<string, LogDayMark>): Map<string, YearLevel> {
  const out = new Map<string, YearLevel>()
  for (const [day, mark] of marks) out.set(day, mark === 'done' ? 4 : mark === 'entry' ? 2 : 'open')
  return out
}

/**
 * The sidebar's month: how much is on each day of the year, tasks and events and the day's note
 * counted alike, against the busiest day of that year, so a quiet year still shows its shape.
 */
export function levelsOfCounts(counts: ReadonlyMap<string, number>): Map<string, YearLevel> {
  const max = Math.max(0, ...counts.values())
  const out = new Map<string, YearLevel>()
  for (const [day, n] of counts) {
    const level = heatLevel(n, max)
    if (level) out.set(day, level)
  }
  return out
}
