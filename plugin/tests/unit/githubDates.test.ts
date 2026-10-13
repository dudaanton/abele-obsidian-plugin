import { afterEach, expect, it, vi } from 'vitest'
import { shortDate } from '@/github/format'

afterEach(() => vi.useRealTimers())

it('keeps narrow-row dates short while preserving the year for older entries', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2030, 5, 12, 12))
  expect(shortDate(new Date(2030, 5, 10, 9, 30).toISOString())).toBe('10 Jun, 09:30')
  expect(shortDate(new Date(2029, 5, 10, 9, 30).toISOString())).toBe('10 Jun 2029')
  expect(shortDate(undefined)).toBe('')
  expect(shortDate('invalid')).toBe('')
})
