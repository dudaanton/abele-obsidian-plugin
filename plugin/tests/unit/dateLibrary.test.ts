import { describe, expect, it } from 'vitest'
import dayjs from '@/helpers/dateLibrary'

describe('date library setup independent of plugin bootstrap', () => {
  it('provides formatted parsing, week configuration and yearly days on first import', () => {
    expect(dayjs('31.12.2024', 'DD.MM.YYYY').format('YYYY-MM-DD')).toBe('2024-12-31')
    expect(dayjs('2024-02-29').dayOfYear()).toBe(60)
    expect(dayjs('2024-01-03').isoWeek()).toBe(1)
    const old = dayjs.Ls.en.weekStart
    try {
      dayjs.updateLocale('en', { weekStart: 1 })
      expect(dayjs('2024-01-03').startOf('week').format('YYYY-MM-DD')).toBe('2024-01-01')
    } finally {
      dayjs.updateLocale('en', { weekStart: old })
    }
  })
})
