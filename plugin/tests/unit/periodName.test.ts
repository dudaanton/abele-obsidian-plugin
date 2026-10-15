import { describe, expect, it } from 'vitest'
import dayjs from 'dayjs'
import { periodName } from '@/helpers/periodName'

describe('periodName', () => {
  it('names a whole month by its name and year', () => {
    expect(periodName(dayjs('2026-10-01').startOf('day'), dayjs('2026-10-31').endOf('day'))).toBe(
      'October 2026'
    )
  })

  it('names any other range by its first and last day, as the period picker does', () => {
    expect(periodName(dayjs('2026-10-03'), dayjs('2026-10-20'))).toBe('Oct 3, 2026 — Oct 20, 2026')
    expect(periodName(dayjs('2026-09-01'), dayjs('2026-10-31'))).toBe('Sep 1, 2026 — Oct 31, 2026')
  })
})
