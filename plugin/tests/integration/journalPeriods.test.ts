import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import dayjs from 'dayjs'
import dayOfYear from 'dayjs/plugin/dayOfYear'
import updateLocale from 'dayjs/plugin/updateLocale'
import { flushPromises } from '@vue/test-utils'
import { Journal, type JournalDTO } from '@/entities/Journal'
import { GlobalStore } from '@/stores/GlobalStore'
import { dailyJournal, useVault } from '../helpers/testEnv'

// Match main.ts's Dayjs setup, but restore the global locale and TZ after every case.
dayjs.extend(dayOfYear)
dayjs.extend(updateLocale)
let oldTZ: string | undefined
let oldWeekStart: number | undefined
beforeEach(() => {
  oldTZ = process.env.TZ
  oldWeekStart = dayjs.Ls.en.weekStart
  process.env.TZ = 'Europe/Berlin'
  dayjs.updateLocale('en', { weekStart: 0 })
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2024-03-31T00:30:00+01:00'))
})
afterEach(() => {
  dayjs.updateLocale('en', { weekStart: oldWeekStart })
  if (oldTZ === undefined) delete process.env.TZ
  else process.env.TZ = oldTZ
  vi.useRealTimers()
})
const journal = (recurrence: JournalDTO['recurrence'], dayOfPeriod?: JournalDTO['dayOfPeriod']) =>
  new Journal(dailyJournal({ recurrence, dayOfPeriod }))
const date = (value: dayjs.Dayjs | null) => value?.format('YYYY-MM-DD') ?? null

describe('journal period navigation', () => {
  it.each([
    ['daily', undefined, '2024-02-29', '2024-03-02'],
    ['weekly', undefined, '2024-02-23', '2024-03-08'],
    ['monthly', undefined, '2024-02-01', '2024-04-01'],
    ['monthly', 'first', '2024-02-01', '2024-04-01'],
    ['monthly', 'last', '2024-02-29', '2024-04-30'],
    ['monthly', 15, '2024-02-15', '2024-04-15'],
    ['yearly', undefined, '2023-03-01', '2025-03-01'],
    ['yearly', 'first', '2023-01-01', '2025-01-01'],
    ['yearly', 'last', '2023-12-31', '2025-12-31'],
    ['yearly', 60, '2023-03-01', '2025-03-01'],
  ] as const)('%s / %s visits the neighbouring periods', (recurrence, day, prev, next) => {
    const j = journal(recurrence, day)
    const from = dayjs('2024-03-01T12:34:56')
    expect(date(j.getPrevDate(from))).toBe(prev)
    expect(date(j.getNextDate(from))).toBe(next)
    expect(from.format('YYYY-MM-DDTHH:mm:ss')).toBe('2024-03-01T12:34:56')
  })

  it.each([
    [0, 'first', '2023-12-24', '2024-01-07'],
    [0, 'last', '2023-12-30', '2024-01-13'],
    [0, 1, '2023-12-24', '2024-01-07'],
    [0, 7, '2023-12-30', '2024-01-13'],
    [0, 8, '2023-12-24', '2024-01-07'],
    [1, 'first', '2023-12-25', '2024-01-08'],
    [1, 'last', '2023-12-31', '2024-01-14'],
    [1, 1, '2023-12-25', '2024-01-08'],
    [1, 7, '2023-12-31', '2024-01-14'],
  ] as const)('week start %s / day %s crosses the year', (weekStart, day, prev, next) => {
    dayjs.updateLocale('en', { weekStart })
    const j = journal('weekly', day)
    expect(date(j.getPrevDate(dayjs('2024-01-03')))).toBe(prev)
    expect(date(j.getNextDate(dayjs('2024-01-03')))).toBe(next)
  })

  it('preserves local wall time across a DST change and handles leap-day clamping', () => {
    const from = dayjs('2024-03-30T12:00:00')
    const next = journal('daily').getNextDate(from)
    expect(next.format('YYYY-MM-DDTHH:mm:ssZ')).toBe('2024-03-31T12:00:00+02:00')
    expect(next.diff(from, 'hour')).toBe(23)
    expect(date(journal('monthly').getNextDate(dayjs('2024-01-31')))).toBe('2024-02-29')
    expect(date(journal('yearly').getNextDate(dayjs('2024-02-29')))).toBe('2025-02-28')
    expect(date(journal('daily').getPrevDate(dayjs('2024-01-01')))).toBe('2023-12-31')
  })

  it('pins numeric overflow rather than silently clamping configured days', () => {
    expect(date(journal('monthly', 31).getNextDate(dayjs('2024-01-31')))).toBe('2024-03-02')
    expect(date(journal('monthly', 31).getPrevDate(dayjs('2024-03-31')))).toBe('2024-03-02')
    expect(date(journal('yearly', 366).getNextDate(dayjs('2024-01-01')))).toBe('2026-01-01')
    expect(date(journal('yearly', 60).getNextDate(dayjs('2023-01-01')))).toBe('2024-02-29')
  })

  it.each([
    ['daily', undefined, '2024-02-29', true],
    ['weekly', undefined, '2024-01-07', false],
    ['weekly', 'first', '2024-01-07', true],
    ['weekly', 'first', '2024-01-08', false],
    ['weekly', 'last', '2024-01-13', true],
    ['weekly', 2, '2024-01-08', true],
    ['weekly', 2, '2024-01-09', false],
    ['monthly', undefined, '2024-02-01', false],
    ['monthly', 'first', '2024-02-01', true],
    ['monthly', 'first', '2024-02-02', false],
    ['monthly', 'last', '2024-02-29', true],
    ['monthly', 'last', '2023-02-28', true],
    ['monthly', 'last', '2024-02-28', false],
    ['monthly', 31, '2024-04-30', false],
    ['monthly', 15, '2024-04-15', true],
    ['yearly', undefined, '2024-01-01', false],
    ['yearly', 'first', '2024-01-01', true],
    ['yearly', 'first', '2024-01-02', false],
    ['yearly', 'last', '2024-12-31', true],
    ['yearly', 'last', '2024-12-30', false],
    ['yearly', 60, '2024-02-29', true],
    ['yearly', 60, '2023-03-01', true],
    ['yearly', 366, '2023-12-31', false],
  ] as const)('isJournalDate: %s / %s on %s is %s', (recurrence, day, input, expected) => {
    expect(journal(recurrence, day).isJournalDate(dayjs(input))).toBe(expected)
  })

  it('recognises first and last with a Monday week start', () => {
    dayjs.updateLocale('en', { weekStart: 1 })
    expect(journal('weekly', 'first').isJournalDate(dayjs('2024-01-01'))).toBe(true)
    expect(journal('weekly', 'last').isJournalDate(dayjs('2024-01-07'))).toBe(true)
  })

  // BUG: numeric weekly navigation counts from locale week start, but isJournalDate counts
  // from Sunday. With Monday weeks, a date reached by Next is not a journal date.
  it('recognises the numeric weekly date reached by navigation in a Monday locale', () => {
    dayjs.updateLocale('en', { weekStart: 1 })
    const j = journal('weekly', 1)
    expect(j.isJournalDate(j.getNextDate(dayjs('2024-01-01')))).toBe(true)
  })
})

describe.each([0, 1, 6])('numeric weekly dates with week start %s', (weekStart) => {
  it.each([1, 2, 7, 8])('recognises only day %s in each neighbouring week', (day) => {
    dayjs.updateLocale('en', { weekStart })
    const j = journal('weekly', day)
    for (const from of ['2024-01-01', '2024-03-31', '2024-12-31']) {
      for (const target of [j.getPrevDate(dayjs(from)), j.getNextDate(dayjs(from))]) {
        expect(j.isJournalDate(target)).toBe(true)
        expect(j.isJournalDate(target.add(1, 'day'))).toBe(false)
        expect(j.isJournalDate(target.subtract(1, 'day'))).toBe(false)
      }
    }
  })
})

describe('journal configuration, lookup and creation', () => {
  it('round trips every option, generates missing IDs, and leaves valid days unchanged on bad input', () => {
    const dto = dailyJournal({
      templatePath: 'Templates/Day.md',
      dateProperty: 'day',
      dayOfPeriod: 366,
    })
    const j = new Journal(dto)
    expect(j.toDTO()).toEqual(dto)
    expect(new Journal({ ...dto, id: undefined }).id).toEqual(expect.any(String))
    for (const invalid of [0, -1, 367, NaN, Infinity, '2', 'bad', undefined]) {
      j.dayOfPeriod = invalid
      expect(j.dayOfPeriod).toBe(366)
    }
    j.dayOfPeriod = 1.5
    expect(j.dayOfPeriod).toBe(1.5) // Fractional days are currently accepted.
    expect(j.isDefaultDailyJournal).toBe(true)
    expect(new Journal({ ...dto, isDefault: false }).isDefaultDailyJournal).toBe(false)
    expect(journal('weekly').isDefaultDailyJournal).toBe(false)
  })

  it.each([null, '', 'not a date'])(
    'falls back from an unusable configured property (%s)',
    (day) => {
      useVault([{ path: 'Days/2024-02-29.md', frontmatter: { type: 'journal', day } }])
      const j = new Journal(dailyJournal({ dateProperty: 'day' }))
      expect(date(j.checkIfNotePathIsJournal('Days/2024-02-29.md'))).toBe('2024-02-29')
    }
  )

  it.each(['findClosestPrevNote', 'findClosestNextNote'] as const)(
    '%s skips gaps, excludes today and includes period 100 only',
    (method) => {
      const j = journal('daily')
      const from = dayjs('2024-01-01')
      const sign = method === 'findClosestNextNote' ? 1 : -1
      const path = (offset: number) =>
        `Journals/${from.add(offset * sign, 'day').format('YYYY/YYYY-MM-DD')}.md`
      useVault([{ path: path(0) }, { path: path(3) }, { path: path(100) }])
      expect(date(j[method](from))).toBe(date(from.add(3 * sign, 'day')))
      const app = useVault([{ path: path(100) }, { path: path(101) }])
      expect(date(j[method](from))).toBe(date(from.add(100 * sign, 'day')))
      expect(app.stats.getAbstractFileByPath).toBe(100)
      useVault([{ path: path(101) }])
      expect(j[method](from)).toBeNull()
    }
  )

  it('requires a file at the rendered path, not a folder or a matching type elsewhere', () => {
    useVault([
      { path: 'Journals/2024/2024-01-01.md/Child.md' },
      { path: 'Elsewhere.md', frontmatter: { type: 'journal' } },
    ])
    const j = journal('daily')
    expect(j.isJournalNoteCreated(dayjs('2024-01-01'))).toBe(false)
    j.newPathTemplate = undefined
    expect(j.isJournalNoteCreated(dayjs('2024-01-01'))).toBe(false)
    expect(j.findClosestNextNote(dayjs('2024-01-01'))).toBeNull()
  })

  it.each([
    ['daily', 'Daily/{{date}}', 'Daily/2024-02-29.md'],
    ['weekly', 'Weekly/{{date:YYYY-MM-DD}}', 'Weekly/2024-02-29.md'],
    ['monthly', 'Monthly/{{date:YYYY-MM}}.md', 'Monthly/2024-02.md'],
    ['yearly', 'Yearly/{{date:YYYY}}', 'Yearly/2024.md'],
  ] as const)(
    'creates and reopens a %s note without overwriting it',
    async (recurrence, newPathTemplate, path) => {
      const app = useVault([
        {
          path: 'Templates/Period.md',
          content: '---\ntype: journal\nday: {{date}}\n---\nPeriod {{date:MMMM YYYY}}',
        },
      ])
      const openLinkText = vi.fn()
      Object.assign(app, { workspace: { openLinkText } })
      const j = new Journal(
        dailyJournal({ recurrence, newPathTemplate, templatePath: 'Templates/Period.md' })
      )
      j.createJournalNote(dayjs('2024-02-29'))
      await flushPromises() // createJournalNote deliberately exposes no promise.
      expect(j.isJournalNoteCreated(dayjs('2024-02-29'))).toBe(true)
      const file = GlobalStore.getInstance().app.vault.getFileByPath(path)!
      expect(await app.vault.read(file)).toBe(
        '---\ntype: journal\nday: 2024-02-29\n---\nPeriod February 2024'
      )
      j.createJournalNote(dayjs('2024-02-29'))
      await flushPromises()
      expect(app.stats.create).toBe(1)
      expect(openLinkText.mock.calls).toEqual([
        [path, '', false],
        [path, '', false],
      ])
    }
  )
})
