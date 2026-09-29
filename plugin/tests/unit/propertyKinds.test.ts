/**
 * The values behind the date, priority and labels widgets: a date stepped a day at a time in the
 * shape it was written, how far away it is in words, the task priority scale stepped up and down,
 * and a list of labels added to and taken from.
 */
import { describe, it, expect } from 'vitest'
import { isDateValue, relativeTime, stepDate, timeOf, withDay } from '@/properties/dates'
import { priorityLevel, priorityName, stepPriority } from '@/properties/priority'
import {
  addLabel,
  collectLabels,
  isLabelsValue,
  labelsOf,
  removeLabel,
  suggestLabels,
} from '@/properties/labels'

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min)

describe('stepping a date', () => {
  it('moves a date a day either way', () => {
    expect(stepDate('2026-05-10', 1)).toBe('2026-05-11')
    expect(stepDate('2026-05-10', -1)).toBe('2026-05-09')
  })

  it('rolls over the end of a month and a year', () => {
    expect(stepDate('2026-01-31', 1)).toBe('2026-02-01')
    expect(stepDate('2026-03-01', -1)).toBe('2026-02-28')
    expect(stepDate('2028-02-28', 1)).toBe('2028-02-29')
    expect(stepDate('2028-03-01', -1)).toBe('2028-02-29')
    expect(stepDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(stepDate('2027-01-01', -1)).toBe('2026-12-31')
  })

  it('keeps a date and time a date and time, its time untouched', () => {
    expect(stepDate('2026-04-30T23:30', 1)).toBe('2026-05-01T23:30')
    expect(stepDate('2026-05-01 08:15:20', -1)).toBe('2026-04-30 08:15:20')
    expect(stepDate('2026-05-01T08:15+02:00', 1)).toBe('2026-05-02T08:15+02:00')
  })

  it('is exactly a day over a change of summer time', () => {
    expect(stepDate('2026-03-28T12:00', 1)).toBe('2026-03-29T12:00')
    expect(stepDate('2026-10-25', 1)).toBe('2026-10-26')
  })

  it('counts an empty or missing value as today', () => {
    const today = at(2026, 6, 30, 15)
    expect(stepDate(null, 1, today)).toBe('2026-07-01')
    expect(stepDate(undefined, -1, today)).toBe('2026-06-29')
    expect(stepDate('  ', 0, today)).toBe('2026-06-30')
  })

  it('leaves alone what is not a date', () => {
    expect(stepDate('someday', 1)).toBeNull()
    expect(stepDate('2026-02-30', 1)).toBeNull()
    expect(stepDate(42, 1)).toBeNull()
    expect(isDateValue('someday')).toBe(false)
    expect(isDateValue(null)).toBe(true)
    expect(isDateValue('2026-02-01T10:00')).toBe(true)
  })

  it('takes a picked day and time in the shape the value had', () => {
    expect(withDay('2026-05-01', '2026-06-02')).toBe('2026-06-02')
    expect(withDay('2026-05-01T09:30', '2026-06-02', '10:45')).toBe('2026-06-02T10:45')
    expect(withDay('2026-05-01 09:30:15', '2026-06-02', '10:45')).toBe('2026-06-02 10:45:15')
    expect(withDay(null, '2026-06-02')).toBe('2026-06-02')
    expect(withDay(null, '2026-06-02', '07:00')).toBe('2026-06-02T07:00')
  })

  it('reads a time written beside a date', () => {
    expect(timeOf('14:30')).toBe('14:30')
    expect(timeOf('9:05')).toBe('09:05')
    expect(timeOf('25:00')).toBeNull()
    expect(timeOf(null)).toBeNull()
  })
})

describe('how far a date is', () => {
  const now = at(2026, 5, 10, 12, 0)

  it('says it in days for a date', () => {
    expect(relativeTime('2026-05-10', now)).toBe('today')
    expect(relativeTime('2026-05-11', now)).toBe('tomorrow')
    expect(relativeTime('2026-05-09', now)).toBe('yesterday')
    expect(relativeTime('2026-05-13', now)).toBe('in 3 days')
    expect(relativeTime('2026-05-08', now)).toBe('2 days ago')
    expect(relativeTime('2026-06-01', now)).toBe('in 22 days')
  })

  it('says it in days and hours for a date with a time', () => {
    expect(relativeTime('2026-05-11T17:00', now)).toBe('in 1 d 5 h')
    expect(relativeTime('2026-05-12T12:00', now)).toBe('in 2 d')
    expect(relativeTime('2026-05-09T07:00', now)).toBe('1 d 5 h ago')
  })

  it('in hours only when less than a day is left', () => {
    expect(relativeTime('2026-05-10T17:30', now)).toBe('in 5 h')
    expect(relativeTime('2026-05-11T11:59', now)).toBe('in 23 h')
    expect(relativeTime('2026-05-10T09:00', now)).toBe('3 h ago')
    expect(relativeTime('2026-05-10T12:25', now)).toBe('in 25 min')
    expect(relativeTime('2026-05-10T12:00', now)).toBe('now')
  })

  it('takes the time from beside the date when the value has none', () => {
    expect(relativeTime('2026-05-11', now, '17:00')).toBe('in 1 d 5 h')
  })

  it('says nothing for what is not a date', () => {
    expect(relativeTime('soon', now)).toBeNull()
    expect(relativeTime(null, now)).toBeNull()
  })
})

describe('a priority', () => {
  it('reads the task scale, whatever the case', () => {
    expect(priorityLevel(null)).toBe(0)
    expect(priorityLevel('')).toBe(0)
    expect(priorityLevel('low')).toBe(1)
    expect(priorityLevel('Medium')).toBe(2)
    expect(priorityLevel(['high'])).toBe(3)
    expect(priorityLevel('urgent')).toBeNull()
  })

  it('raises and lowers a step at a time, from none to high', () => {
    expect(stepPriority(null, 1)).toBe('low')
    expect(stepPriority('low', 1)).toBe('medium')
    expect(stepPriority('MEDIUM', 1)).toBe('high')
    expect(stepPriority('high', -1)).toBe('medium')
    expect(stepPriority('low', -1)).toBeNull()
  })

  it('goes nowhere past the ends, or from what is not a priority', () => {
    expect(stepPriority('high', 1)).toBeUndefined()
    expect(stepPriority(null, -1)).toBeUndefined()
    expect(stepPriority('urgent', 1)).toBeUndefined()
  })

  it('names each level', () => {
    expect([0, 1, 2, 3].map(priorityName)).toEqual(['None', 'Low', 'Medium', 'High'])
  })
})

describe('labels', () => {
  it('reads one label or a list, an empty value as none', () => {
    expect(labelsOf(null)).toEqual([])
    expect(labelsOf('')).toEqual([])
    expect(labelsOf('work')).toEqual(['work'])
    expect(labelsOf(['work', '#home', 'Work'])).toEqual(['work', 'home'])
    expect(isLabelsValue(['a', 'b'])).toBe(true)
    expect(isLabelsValue({ a: 1 })).toBe(false)
  })

  it('adds a label at the end as a list, once whatever its case', () => {
    expect(addLabel(null, 'work')).toEqual(['work'])
    expect(addLabel('work', ' #home ')).toEqual(['work', 'home'])
    expect(addLabel(['work'], 'WORK')).toBeNull()
    expect(addLabel(['work'], '  ')).toBeNull()
  })

  it('takes a label off, leaving nothing once the last is gone', () => {
    expect(removeLabel(['work', 'home'], 'Work')).toEqual(['home'])
    expect(removeLabel(['work'], 'work')).toBeNull()
    expect(removeLabel(null, 'work')).toBeNull()
  })

  it('treats status labels as ordinary labels', () => {
    expect(addLabel(['todo'], 'inwork')).toEqual(['todo', 'inwork'])
    expect(removeLabel(['todo', 'inwork'], 'todo')).toEqual(['inwork'])
  })

  it('collects the vault’s labels, most used first', () => {
    expect(collectLabels([['work', 'home'], 'work', null, ['Errands', 'WORK'], ['home']])).toEqual([
      'work',
      'home',
      'Errands',
    ])
  })

  it('offers what the property does not hold, matching what is typed', () => {
    const known = ['work', 'homework', 'home', 'errands']
    expect(suggestLabels(known, ['errands'], '')).toEqual(['work', 'homework', 'home'])
    expect(suggestLabels(known, [], 'hom')).toEqual(['homework', 'home'])
    expect(suggestLabels(known, [], 'work')).toEqual(['work', 'homework'])
  })
})

describe('labels written as links', () => {
  it('stay links when another label is added or taken off', () => {
    expect(addLabel(['[[Area/Work|Job]]'], 'home')).toEqual(['[[Area/Work|Job]]', 'home'])
    expect(removeLabel(['[[Area/Work|Job]]', 'home'], 'home')).toEqual(['[[Area/Work|Job]]'])
    expect(removeLabel(['[[Area/Work|Job]]', 'home'], 'Job')).toEqual(['home'])
  })
})
