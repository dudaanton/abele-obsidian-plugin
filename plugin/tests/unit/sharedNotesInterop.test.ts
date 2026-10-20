import { describe, expect, it } from 'vitest'
import * as shared from '@abele/sync-sdk/notes'
import dayjs from '@/helpers/dateLibrary'
import parseFrontmatter from '@/helpers/noteFrontmatter'
import { loadCalendarYaml, dumpCalendarYaml } from '@/helpers/yamlDates'
import { applyTimeToDate } from '@/helpers/datesHelper'
import { RecurrenceParser } from '@/helpers/RecurrenceParser'
import { parseLabels } from '@/helpers/taskMeta'
import { buildTaskTree } from '@/helpers/taskTree'
import { normalizePath } from '@/helpers/pathsHelpers'

describe('public notes package interoperability', () => {
  it('routes old helper paths to the public package functions', () => {
    expect(parseFrontmatter).toBe(shared.parseFrontmatter)
    expect(loadCalendarYaml).toBe(shared.loadCalendarYaml)
    expect(dumpCalendarYaml).toBe(shared.dumpCalendarYaml)
    expect(applyTimeToDate).toBe(shared.applyTimeToDate)
    expect(RecurrenceParser).toBe(shared.RecurrenceParser)
    expect(parseLabels).toBe(shared.parseLabels)
    expect(buildTaskTree).toBe(shared.buildTaskTree)
    expect(normalizePath).toBe(shared.normalizePath)
    expect(normalizePath('Sample')).toBe('Sample.md')
  })

  it('shares one Dayjs instance, its plugins and locale changes through both paths', () => {
    expect(dayjs).toBe(shared.dayjs)
    const old = dayjs.Ls.en.weekStart
    try {
      shared.dayjs.updateLocale('en', { weekStart: 1 })
      expect(dayjs('2032-01-07').startOf('week').day()).toBe(1)
      dayjs.updateLocale('en', { weekStart: 0 })
      expect(shared.dayjs('2032-01-07').weekday()).toBe(3)
      expect(shared.dayjs('29.02.2032', 'DD.MM.YYYY').dayOfYear()).toBe(60)
      expect(dayjs('2032-01-07').isoWeek()).toBe(2)
    } finally {
      dayjs.updateLocale('en', { weekStart: old })
    }
  })

  it('retains YAML calendar spelling when reader and writer use different import paths', () => {
    const yaml = "day: 2032-04-05\nquoted: '2032-04-05'\nstart: 2032-04-05T00:00:00Z\n"
    for (const [load, dump] of [
      [loadCalendarYaml, shared.dumpCalendarYaml],
      [shared.loadCalendarYaml, dumpCalendarYaml],
    ] as const) {
      const written = dump(load(yaml))
      expect(written).toContain('day: 2032-04-05\n')
      expect(written).toContain("quoted: '2032-04-05'\n")
      expect(written).toContain('start: 2032-04-05T00:00:00.000Z\n')
    }
  })

  it('keeps a valid date unchanged for absent or invalid time', () => {
    const date = dayjs('2032-04-05')
    expect(shared.applyTimeToDate(date, null)).toBe(date)
    expect(applyTimeToDate(date, dayjs('invalid'))).toBe(date)
    expect(shared.applyTimeToDate(null, dayjs())).toBeNull()
  })
})
