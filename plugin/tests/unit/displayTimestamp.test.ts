import { describe, it, expect } from 'vitest'
import { formatTimestamp } from '@/helpers/displayFormat'

describe('timestamp presentation', () => {
  it('uses calendar days rather than elapsed hours at midnight', () => {
    const value = formatTimestamp('2026-04-04T23:59:00Z', {
      now: new Date('2026-04-05T00:01:00Z'),
      timeZone: 'UTC',
    })
    expect(value.label).toBe('Yesterday, 23:59')
    expect(value.exact).toBe('04.04.2026, 23:59')
  })
  it('uses the requested timezone across a DST boundary', () => {
    const value = formatTimestamp('2026-03-08T07:01:00Z', {
      now: new Date('2026-03-08T08:00:00Z'),
      timeZone: 'America/New_York',
      diagnostic: true,
    })
    expect(value.label).toBe('Today, 03:01')
    expect(value.exact).toContain('08.03.2026, 03:01:00')
    expect(value.exact).toContain('America/New_York')
  })
  it('disambiguates repeated fall-back clock times diagnostically', () => {
    const a = formatTimestamp('2026-11-01T05:30:00Z', {
      timeZone: 'America/New_York',
      diagnostic: true,
    })
    const b = formatTimestamp('2026-11-01T06:30:00Z', {
      timeZone: 'America/New_York',
      diagnostic: true,
    })
    expect(a.exact).not.toBe(b.exact)
  })
  it.each([undefined, null, '', 'not a timestamp', NaN, new Date(NaN)])(
    'makes %s unknown',
    (value) => {
      expect(formatTimestamp(value)).toEqual({
        label: 'Time unknown',
        exact: 'Time unknown',
        datetime: undefined,
      })
    }
  )
  it('does not confuse epoch zero with a missing value', () => {
    expect(formatTimestamp(0, { mode: 'absolute', timeZone: 'UTC' }).label).toBe(
      '01.01.1970, 00:00'
    )
  })
})
