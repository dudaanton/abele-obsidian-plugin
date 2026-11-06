import { afterEach, expect, it, vi } from 'vitest'
import { streamBTime } from '@/i18n/streamBDate'
import { initializeLocale } from '@/i18n'
import { timestampTimeZone } from '@/helpers/displayFormat'

afterEach(() => {
  vi.restoreAllMocks()
  initializeLocale('en')
})

it('constructs formatters per zone rather than per mounted message', () => {
  const NativeFormatter = Intl.DateTimeFormat
  const construct = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locale, options) {
    return new NativeFormatter(locale, options)
  })
  const start = performance.now()
  for (let page = 0; page < 10; page++) {
    for (let row = 0; row < 30; row++) {
      const value = streamBTime(Date.UTC(2025, 0, 1, 0, row), {
        timeZone: 'Pacific/Honolulu',
        now: new Date('2025-01-01T12:00:00Z'),
      })
      expect(value.today).toBe(false)
      expect(value.clock).toBe(`14:${String(row).padStart(2, '0')}`)
    }
  }
  console.info(
    '300 timestamp mounts',
    performance.now() - start,
    'ms; Intl constructors',
    construct.mock.calls.length
  )
  expect(construct.mock.calls.length).toBeLessThanOrEqual(2)
})

it('shares host zone discovery within a render and refreshes it in the next turn', async () => {
  await Promise.resolve()
  const resolved = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
  const options = new Intl.DateTimeFormat().resolvedOptions()
  resolved.mockReturnValue({ ...options, timeZone: 'UTC' })
  resolved.mockClear()
  for (let row = 0; row < 30; row++) expect(timestampTimeZone()).toBe('UTC')
  expect(resolved).toHaveBeenCalledTimes(1)
  await Promise.resolve()
  resolved.mockReturnValue({ ...options, timeZone: 'Asia/Tokyo' })
  expect(timestampTimeZone()).toBe('Asia/Tokyo')
  expect(resolved).toHaveBeenCalledTimes(2)
})

it('keeps calendar-day labels fresh across midnight with reused formatters', () => {
  const value = '2025-02-01T23:59:00Z'
  expect(streamBTime(value, { timeZone: 'UTC', now: new Date(value) }).today).toBe(true)
  expect(streamBTime(value, { timeZone: 'UTC', now: new Date('2025-02-02T00:01:00Z') }).today).toBe(
    false
  )
  expect(
    streamBTime(value, { timeZone: 'Asia/Tokyo', now: new Date('2025-02-02T00:01:00Z') }).today
  ).toBe(true)
})
