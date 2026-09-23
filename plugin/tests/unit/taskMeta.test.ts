/**
 * Priority and labels are typed by hand into a task's properties, so reading them has to
 * forgive case, stray spaces, lists where one value was meant and the ways YAML turns a
 * wikilink into something else. What cannot be read is simply absent.
 */
import { describe, it, expect } from 'vitest'
import {
  labelColor,
  parseLabels,
  parsePriority,
  priorityRank,
  sortByPriority,
} from '@/helpers/taskMeta'

describe('parsePriority', () => {
  it('reads the three levels in any case and spacing', () => {
    expect(parsePriority('high')).toBe('high')
    expect(parsePriority(' Medium ')).toBe('medium')
    expect(parsePriority('LOW')).toBe('low')
  })

  it('takes the first entry of a list', () => {
    expect(parsePriority(['High', 'low'])).toBe('high')
  })

  it('treats anything else as no priority', () => {
    expect(parsePriority('urgent')).toBeNull()
    expect(parsePriority(3)).toBeNull()
    expect(parsePriority(undefined)).toBeNull()
    expect(parsePriority('')).toBeNull()
    expect(parsePriority([])).toBeNull()
  })

  it('ranks high above medium above low above none', () => {
    expect(priorityRank('high')).toBeGreaterThan(priorityRank('medium'))
    expect(priorityRank('medium')).toBeGreaterThan(priorityRank('low'))
    expect(priorityRank('low')).toBeGreaterThan(priorityRank(null))
  })
})

describe('sortByPriority', () => {
  it('puts higher priority first and keeps the incoming order within a level', () => {
    const tasks = [
      { id: 'a', priority: null },
      { id: 'b', priority: 'low' as const },
      { id: 'c', priority: 'high' as const },
      { id: 'd', priority: null },
      { id: 'e', priority: 'high' as const },
      { id: 'f', priority: 'medium' as const },
    ]
    expect(sortByPriority(tasks).map((t) => t.id)).toEqual(['c', 'e', 'f', 'b', 'a', 'd'])
  })

  it('does not reorder the array it was given', () => {
    const tasks = [
      { id: 'a', priority: null },
      { id: 'b', priority: 'high' as const },
    ]
    sortByPriority(tasks)
    expect(tasks.map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('parseLabels', () => {
  it('reads a string as one label, commas included', () => {
    expect(parseLabels('work, home')).toEqual(['work, home'])
  })

  it('reads a list as one label per entry', () => {
    expect(parseLabels(['work', 'home'])).toEqual(['work', 'home'])
  })

  it('turns numbers and booleans into text', () => {
    expect(parseLabels([2026, true])).toEqual(['2026', 'true'])
  })

  it('drops empty entries and anything that is not a value', () => {
    expect(parseLabels(['', '  ', null, { a: 1 }, 'work'])).toEqual(['work'])
    expect(parseLabels(null)).toEqual([])
    expect(parseLabels(undefined)).toEqual([])
  })

  it('strips a leading hash', () => {
    expect(parseLabels(['#work', '##home'])).toEqual(['work', 'home'])
  })

  it('reads a wikilink as its alias, or else its note name', () => {
    expect(parseLabels(['[[Areas/Work]]', '[[Home|House]]', '[[Plan#Step]]'])).toEqual([
      'Work',
      'House',
      'Plan',
    ])
  })

  it('reads an unquoted wikilink, which YAML parses as a list inside a list', () => {
    expect(parseLabels([['Work'], ['Home']])).toEqual(['Work', 'Home'])
  })

  it('collapses spellings that differ only in case, keeping the first', () => {
    expect(parseLabels(['Work', 'work', ' WORK ', 'home'])).toEqual(['Work', 'home'])
  })
})

describe('labelColor', () => {
  const colors = [
    { value: 'Work', color: 'red' as const },
    { value: 'broken', color: 'magenta' as never },
  ]

  it('finds the colour of a label whatever its case', () => {
    expect(labelColor('work', colors)).toBe('red')
  })

  it('is grey for a label with no colour, or one that is not a kit colour', () => {
    expect(labelColor('home', colors)).toBe('grey')
    expect(labelColor('broken', colors)).toBe('grey')
    expect(labelColor('work', undefined)).toBe('grey')
  })
})
