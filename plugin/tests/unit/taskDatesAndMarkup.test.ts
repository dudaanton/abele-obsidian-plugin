import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import dayjs from 'dayjs'
import { Task } from '@/entities/Task'
import { TaskNoteTemplate } from '@/templates/TaskNoteTemplate'
import { parseNoteContent } from '@/helpers/notesUtils'
import { applyTimeToDate, parseDateOrNull, parseDateTimeOrNull } from '@/helpers/datesHelper'
import * as markup from '@/helpers/tasksUtils'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  vi.stubEnv('TZ', 'Europe/Berlin')
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2028-01-31T23:30:00+01:00'))
  useVault([])
  AbeleConfig.getInstance().tasksFolder = 'Tasks'
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('task dates and ordering', () => {
  it.each([
    [{}, null],
    [{ created: '2028-01-01' }, '2028-01-01'],
    [{ date: '2028-02-01', created: '2028-01-01' }, '2028-02-01'],
    [{ due: '2028-02-02', created: '2028-01-01' }, '2028-02-02'],
    [{ date: '2028-02-01', due: '2028-02-02' }, '2028-02-01'],
    [{ date: '2028-02-02', due: '2028-02-01' }, '2028-02-01'],
    [{ date: 'invalid', due: '2028-02-01' }, '2028-02-01'],
    [{ date: '', due: '', created: 'invalid' }, null],
  ])('resolveDate(%j)', (params, expected) => {
    expect(Task.resolveDate(params)?.format('YYYY-MM-DD') ?? null).toBe(expected)
  })

  it('returns the due object when dates tie and never uses completion for sorting', () => {
    const date = dayjs('2028-01-01')
    const due = dayjs('2028-01-01')
    const task = new Task({ wikilink: '[[Seed]]', date, due, completedAt: dayjs('2028-02-01') })
    expect(Task.resolveDate({ date, due })).toBe(due)
    expect(task.getTaskDate()).toBe(due)
    expect(task.getTaskDateOrToday()).toBe(due)
  })

  it('places untimed tasks at local end of day, after timed tasks, falling back to today', () => {
    const task = new Task({ wikilink: '[[Seed]]' })
    expect(task.getTaskDate()).toBeNull()
    expect(task.getTaskDateOrToday().valueOf()).toBe(dayjs().valueOf())
    expect(task.hasTime).toBe(false)
    expect(task.getSortTimestamp()).toBe(dayjs().endOf('day').unix())
    task.date = dayjs('2028-01-31 12:00')
    task.dateTime = task.date
    expect(task.hasTime).toBe(true)
    expect(task.getSortTimestamp()).toBe(task.date.unix())
    task.dateTime = null
    task.dueTime = dayjs('2028-02-02 16:00')
    // A time on either endpoint makes the selected (earliest) endpoint timed.
    expect(task.getSortTimestamp()).toBe(task.date.unix())
  })

  it.each([
    [undefined, undefined, []],
    ['2028-02-01', undefined, ['2028-02-01']],
    [undefined, '2028-02-01', ['2028-02-01']],
    ['2028-02-01 09:00', '2028-02-01 17:00', ['2028-02-01']],
    ['2028-02-02', '2028-02-01', ['2028-02-02', '2028-02-01']],
    ['2028-02-28', '2028-03-01', ['2028-02-28', '2028-02-29', '2028-03-01']],
    ['2028-12-31', '2029-01-02', ['2028-12-31', '2029-01-01', '2029-01-02']],
  ])('enumerates date %s through due %s', (date, due, expected) => {
    const task = new Task({
      wikilink: '[[Seed]]',
      date: date ? dayjs(date) : undefined,
      due: due ? dayjs(due) : undefined,
    })
    expect(task.dates).toEqual(expected)
    for (const value of expected) expect(task.isTaskRelatedToDate(dayjs(value).hour(23))).toBe(true)
    expect(task.isTaskRelatedToDate(dayjs('2035-01-01'))).toBe(false)
  })

  it('enumerates a decade without dropping leap days', () => {
    const task = new Task({
      wikilink: '[[Seed]]',
      date: dayjs('2020-01-01'),
      due: dayjs('2030-01-01'),
    })
    expect(task.dates).toHaveLength(3654)
    expect(new Set(task.dates).size).toBe(3654)
  })

  // BUG: the range loop compares instants, then unconditionally appends the due day again.
  // Event 09:00 on Monday, due 17:00 Tuesday yields Tuesday twice to calendar/list consumers.
  it.fails('lists a timed due day only once', () => {
    const task = new Task({
      wikilink: '[[Seed]]',
      date: dayjs('2028-01-03 09:00'),
      due: dayjs('2028-01-04 17:00'),
    })
    expect(task.dates).toEqual(['2028-01-03', '2028-01-04'])
  })

  it('handles absent and malformed date/time fields without inventing a date', () => {
    for (const value of [null, undefined, '', 'not-a-date'])
      expect(parseDateOrNull(value)).toBeNull()
    expect(parseDateTimeOrNull('', '12:00')).toBeNull()
    expect(parseDateTimeOrNull('2028-01-01', '')).toBeNull()
    expect(parseDateTimeOrNull('broken', 'noon')).toBeNull()
    const date = dayjs('2028-01-01')
    expect(applyTimeToDate(date, null)).toBe(date)
    expect(applyTimeToDate(date, dayjs('broken'))).toBe(date)
    expect(applyTimeToDate(null, date)).toBeNull()
    expect(
      applyTimeToDate(date, parseDateTimeOrNull('2028-01-01', '08:45')).format('YYYY-MM-DD HH:mm')
    ).toBe('2028-01-01 08:45')
    // Parsing is intentionally non-strict today.
    expect(parseDateOrNull('2028-02-31')?.format('YYYY-MM-DD')).toBe('2028-03-02')
  })
})

describe('task markup and templates', () => {
  it.each(['[[Seed]]', '[[Tasks/Seed|Water]]'])('round trips an unchecked link %s', (link) => {
    expect(markup.parseTaskLine(markup.createTaskEmbedded(link))).toBe(link)
  })
  it.each([
    '- [x] [[Seed]]',
    '- [X] [[Seed]]',
    ' - [ ] [[Seed]]',
    '- [ ] [[Seed]] text',
    '- [ ] words',
    '- [ ] [[Seed]]\nmore',
  ])('does not parse %j', (line) => {
    expect(markup.parseTaskLine(line)).toBeNull()
  })
  it('creates paths, aliases and timestamped fallback names', () => {
    expect(markup.createTaskEmbeddedFromPath('Tasks/Seed.md', 'Water')).toBe(
      '- [ ] [[Tasks/Seed|Water]]'
    )
    expect(markup.taskLinkFromName('Seed')).toBe('[[Tasks/Seed|Seed]]')
    expect(markup.getNewTaskPathFromString('Seed: water?')).toBe('Tasks/Seed water.md')
    expect(markup.cleanTaskName('Seed: water?')).toBe('Seed water')
    expect(markup.getDefaultTaskName()).toBe('task 20280131233000')
  })
  it('matches all four supported links with escaped punctuation, but not ordinary/completed links', () => {
    const links = ['Tasks/Seed (1)', 'Tasks/Seed (1)|Alias', 'Seed (1)', 'Seed (1)|Alias']
    const text = links.map((link) => `- [ ] [[${link}]]`).join('\n')
    expect(text.replace(markup.createTaskLinkRegex('Tasks/Seed (1).md', 'Seed (1)'), '')).toBe(
      '\n\n\n'
    )
    const other = '[[Seed (1)]]\n- [x] [[Seed (1)]]\n- [ ] [[Seed 1]]\n- [ ] [[Seed (1).md]]'
    expect(other.replace(markup.createTaskLinkRegex('Seed (1)'), '')).toBe(other)
  })
  it('names recurrence from the first nonblank line, cleaning link labels', () => {
    expect(
      markup.getRecurrentTaskTitle('\n\nWater [[Plants|seedlings]]\nDetails', dayjs('2028-02-01'))
    ).toBe('Water seedlings 2028-02-01')
    expect(markup.getRecurrentTaskTitle('Plain\nDetails')).toBe('Plain')
    expect(markup.getRecurrentTaskTitle(' \n')).toBe('New Task')
    expect(markup.getRecurrentTaskTitle('???')).toBe('New Task')
  })

  it('preserves unknown properties/body and distinguishes omitted fields from explicit null', async () => {
    const template = new TaskNoteTemplate(null)
    const oldProps = {
      type: 'note',
      due: '2028-02-01',
      completed: '2028-01-01',
      labels: ['garden'],
      priority: 'high',
      scheduled: '2028-02-05',
      start: '2028-02-06',
      custom: { keep: true },
    }
    const body = '\nWater\n\n- [x] One\n'
    const text = template.createTemplate({
      oldProps,
      content: body,
      completedAt: null,
      date: dayjs('2028-01-31'),
      dateTime: dayjs('2028-01-31 08:45'),
      createdAt: dayjs('2027-12-31'),
      recurrence: 'every day',
    })
    const parsed = await parseNoteContent(null, text)
    expect(parsed).toMatchObject({
      type: 'task',
      due: '2028-02-01',
      date: '2028-01-31',
      dateTime: '08:45',
      created: '2027-12-31',
      recurrence: 'every day',
      labels: ['garden'],
      priority: 'high',
      scheduled: '2028-02-05',
      start: '2028-02-06',
      custom: { keep: true },
      content: body,
    })
    expect(parsed).not.toHaveProperty('completed')
    expect(oldProps.completed).toBe('2028-01-01')
    expect(template.createTemplate({})).toBe('---\ntype: task\n---\n')
  })
})
