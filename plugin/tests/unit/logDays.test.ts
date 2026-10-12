import { describe, expect, it } from 'vitest'
import { dayMark, logCheck, logsByDay } from '@/logs/logDays'

const on = (date: string, content?: string) => ({
  createdAt: { format: () => date },
  content,
})

describe('a log kept as a checkbox', () => {
  it('is done when its box is ticked, by any mark', () => {
    expect(logCheck('- [x] [[Water the tomatoes]]')).toBe('done')
    expect(logCheck('* [/] [[Water the tomatoes]]')).toBe('done')
  })

  it('is open while any box in it is left', () => {
    expect(logCheck('- [x] morning\n- [ ] evening')).toBe('open')
  })

  it('is no checkbox at all when it is words', () => {
    expect(logCheck('Put the sensor into the shield.')).toBeNull()
    expect(logCheck(undefined)).toBeNull()
  })
})

describe('a day of the calendar', () => {
  it('shows an open box over a ticked one, and a dot for words', () => {
    expect(dayMark([on('d', '- [x] a'), on('d', '- [ ] a')])).toBe('open')
    expect(dayMark([on('d', '- [x] a')])).toBe('done')
    expect(dayMark([on('d', 'Words.')])).toBe('entry')
    expect(dayMark([])).toBeNull()
  })

  it('collects the logs written on it', () => {
    const days = logsByDay([on('2030-07-01', 'a'), on('2030-07-01', 'b'), on('2030-07-02', 'c')])
    expect(days.get('2030-07-01')?.map((l) => l.content)).toEqual(['a', 'b'])
    expect(days.get('2030-07-02')).toHaveLength(1)
  })
})
