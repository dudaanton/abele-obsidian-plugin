import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dateOf,
  formatDay,
  parseDateValue,
  relativeTime,
  stepDate,
  timeOf,
  withDay,
} from '@/properties/dates'
import { priorityAt, priorityLevel, priorityName, stepPriority } from '@/properties/priority'
import {
  addLabel,
  collectLabels,
  isLabelsValue,
  labelsOf,
  removeLabel,
  suggestLabels,
} from '@/properties/labels'
import { pickKind } from '@/properties/kinds'
import { renderCounter } from '@/properties/counterWidget'
import { renderDate } from '@/properties/dateWidget'
import { renderLabels } from '@/properties/labelsWidget'
import { renderGroups } from '@/properties/groupsWidget'
import { renderPriority } from '@/properties/priorityWidget'

beforeEach(() => vi.stubEnv('TZ', 'America/Los_Angeles'))
afterEach(() => vi.unstubAllEnvs())

describe('date property calendar and clock edges', () => {
  it.each([
    '2028-00-01',
    '2028-13-01',
    '2028-02-30',
    '2027-02-29',
    '2028-01-00',
    '2028-01-01T24:00',
    '2028-01-01T12:60',
    '2028-1-1',
    '',
    null,
    new Date('2028-03-01T00:00:00Z'),
  ])('rejects invalid date %j', (value) => {
    expect(parseDateValue(value)).toBeNull()
  })

  it('keeps seconds, fractions, separators and zones as written while stepping or choosing a day', () => {
    const text = ' 2028-02-29 23:15:42.125-0800 '
    expect(parseDateValue(text)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
      time: '23:15',
      hour: 23,
      minute: 15,
      second: 42,
      rest: ' 23:15:42.125-0800',
      zone: '-0800',
    })
    expect(stepDate(text, 1)).toBe('2028-03-01 23:15:42.125-0800')
    expect(withDay(text, '2028-03-02')).toBe('2028-03-02 23:15:42.125-0800')
    expect(withDay(text, '2028-03-02', '08:30')).toBe('2028-03-02 08:30:42.125-0800')
  })

  it('uses local calendar days through DST, but elapsed minutes for zoned timestamps', () => {
    const now = new Date('2028-03-12T00:00:00-08:00')
    expect(formatDay(now)).toBe('2028-03-12')
    expect(stepDate('2028-03-12', 1)).toBe('2028-03-13')
    expect(relativeTime('2028-03-13', now)).toBe('tomorrow')
    expect(relativeTime('2028-03-13T00:00:00-07:00', now)).toBe('in 23 h')
    expect(relativeTime('2028-03-12T00:00:59-08:00', now)).toBe('now')
    expect(relativeTime('2028-03-11T23:59:00-08:00', now)).toBe('1 min ago')
    expect(dateOf(parseDateValue('2028-03-12T03:00:00-07:00')!).toISOString()).toBe(
      '2028-03-12T10:00:00.000Z'
    )
    expect(dateOf(parseDateValue('2028-03-12')!, '03:00').toISOString()).toBe(
      '2028-03-12T10:00:00.000Z'
    )
    expect(timeOf(' 9:05:30 ')).toBe('09:05')
    expect(timeOf('09:60')).toBeNull()
  })

  // BUG: parseDateValue validates hours and minutes but not seconds or timezone offsets.
  // An impossible timestamp is accepted as a date and can produce an invalid relative label.
  it('rejects timestamps with seconds outside the clock range', () => {
    expect(parseDateValue('2028-03-01T12:00:99')).toBeNull()
  })
})

describe('priority and label coercion edges', () => {
  it('handles empty arrays and clamped multi-step priority changes', () => {
    expect(priorityLevel([])).toBe(0)
    expect(priorityLevel('   ')).toBe(0)
    expect(priorityLevel(1)).toBeNull()
    expect(stepPriority(null, 9)).toBe('high')
    expect(stepPriority('high', -9)).toBeNull()
    expect(stepPriority('medium', 0)).toBeUndefined()
    expect(priorityAt(-1)).toBeNull()
    expect(priorityAt(4)).toBeNull()
    expect(priorityName(99)).toBe('None')
  })

  it('retains linked labels, deduplicates per note, ranks ties by spelling, and excludes held keys', () => {
    expect(labelsOf(['#alpha', 'ALPHA', null, '[[Notes/Sample|Sample]]'])).toEqual([
      'alpha',
      'Sample',
    ])
    expect(addLabel(['[[Notes/Sample|Sample]]', null, ''], ' #new ')).toEqual([
      '[[Notes/Sample|Sample]]',
      'new',
    ])
    expect(removeLabel(['[[Notes/Sample|Sample]]', 'new'], 'sample')).toEqual(['new'])
    expect(collectLabels([['beta', 'BETA'], ['alpha'], ['beta'], null])).toEqual(['beta', 'alpha'])
    expect(suggestLabels(['beta', 'alphabet', 'alpha'], ['#BETA'], '#AL')).toEqual([
      'alphabet',
      'alpha',
    ])
    expect(isLabelsValue([null, 2, false])).toBe(true)
    expect(isLabelsValue([{}])).toBe(false)
  })
})

describe('property-kind routing', () => {
  it('uses case-insensitive configured names and stock type constraints for every kind', () => {
    const lists = {
      counterKeys: () => [' Count '],
      dateKeys: () => ['Day'],
      priorityKeys: () => ['Rank'],
      labelKeys: () => ['Tags'],
      groupKeys: () => ['Groups'],
    }
    expect(pickKind(lists, 'count', null, 'number')).toBe(renderCounter)
    expect(pickKind(lists, 'day', '2028-03-01', 'datetime')).toBe(renderDate)
    expect(pickKind(lists, 'rank', 'high', 'text')).toBe(renderPriority)
    expect(pickKind(lists, 'tags', ['sample'], 'multitext')).toBe(renderLabels)
    expect(pickKind(lists, 'groups', ['[[Sample]]'], 'multitext')).toBe(renderGroups)
    expect(pickKind(lists, 'day', 'someday', 'date')).toBeNull()
    expect(pickKind(lists, 'rank', 'high', 'number')).toBeNull()
    expect(pickKind(lists, 'tags', 'sample', 'unknown')).toBeNull()
    expect(pickKind({}, 'tags', 'sample', 'text')).toBeNull()
  })

  it('takes the first listed kind even when it cannot read the value, rather than falling through', () => {
    let counters = ['shared']
    const lists = { counterKeys: () => counters, labelKeys: () => ['shared'] }
    expect(pickKind(lists, 'shared', 'words', 'text')).toBeNull()
    counters = []
    expect(pickKind(lists, 'shared', 'words', 'text')).toBe(renderLabels)
  })
})
