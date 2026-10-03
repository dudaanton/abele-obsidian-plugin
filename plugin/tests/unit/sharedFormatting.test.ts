import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatDuration,
  formatTokenCount,
  parseCommaList,
  relativeDayLabel,
} from '@/helpers/displayFormat'

describe('shared presentation policies', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1048576, '1.0 MB'],
  ])('formats %i bytes without changing units', (value, text) => {
    expect(formatBytes(value)).toBe(text)
  })
  it('preserves padded row minutes and unpadded summary minutes explicitly', () => {
    expect(formatDuration(59)).toBe('0m')
    expect(formatDuration(3660)).toBe('1h 1m')
    expect(formatDuration(3660, true)).toBe('1h 01m')
  })
  it('keeps current token-count policies explicit', () => {
    expect(formatTokenCount(1200)).toBe('1.2k')
    expect(formatTokenCount(1200, { decimals: 0, uppercase: true, millions: true })).toBe('1K')
    expect(formatTokenCount(1200000, { decimals: 0, uppercase: true, millions: true })).toBe('1.2M')
  })
  it('trims comma lists without deduplicating, sorting or losing quoted text', () => {
    expect(parseCommaList(' one, , two, one ')).toEqual(['one', 'two', 'one'])
    expect(parseCommaList('')).toEqual([])
    expect(parseCommaList('"one,two"')).toEqual(['"one', 'two"'])
  })
  it('labels only neighboring local days; date arithmetic stays with the caller', () => {
    expect([0, -1, 1, 2].map(relativeDayLabel)).toEqual(['Today', 'Yesterday', 'Tomorrow', ''])
  })
})
