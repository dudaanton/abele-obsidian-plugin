import { describe, expect, it } from 'vitest'
import { dump, load } from 'js-yaml'
import { dumpCalendarYaml, loadCalendarYaml } from '@/helpers/yamlDates'

describe('calendar-preserving YAML merges', () => {
  it('keeps the direct reader semantics, including Dates and decimal leading-zero numbers', () => {
    const yaml = `day: 2032-04-05
start: 2032-04-05T18:45:12.345+02:00
quoted: '2032-04-05'
number: 012
flag: yes
empty:
nested:
  day: !!timestamp 2032-04-05
list: [&calendar 2032-04-05, *calendar]`
    const value = loadCalendarYaml(yaml)
    expect(value).toEqual(load(yaml))
    const written = dumpCalendarYaml(value)
    expect(load(written)).toEqual(value)
    expect(written).toContain('day: 2032-04-05\n')
    expect(written).toContain('start: 2032-04-05T16:45:12.345Z\n')
    expect(written).not.toContain('2032-04-05T00:00:00')
  })

  it('does not treat explicit UTC or local-midnight timestamps as calendar dates', () => {
    const value = loadCalendarYaml('utc: 2032-04-05T00:00:00Z\noffset: 2032-04-05T00:00:00+09:00')
    expect(dumpCalendarYaml(value)).toBe(dump(value))
    expect(dumpCalendarYaml({ start: new Date('2032-04-05T00:00:00Z') })).toBe(
      'start: 2032-04-05T00:00:00.000Z\n'
    )
  })

  it('preserves the normal dumper quoting decisions for timestamp-looking strings', () => {
    const value = {
      day: '2032-04-05',
      timestamp: '2032-04-05T18:45:12Z',
      text: '2032-04-05 sample',
      invalid: '2032-04-05 [',
      number: '012',
    }
    expect(dumpCalendarYaml(value)).toBe(dump(value))
    expect(load(dumpCalendarYaml(value))).toEqual(value)
  })

  it('handles shared and cyclic mappings without changing their identity', () => {
    const value = loadCalendarYaml(
      'root: &root\n  day: 2032-04-05\n  self: *root\ncopy: *root'
    ) as {
      root: { day: Date; self: unknown }
      copy: unknown
    }
    expect(value.root.self).toBe(value.root)
    expect(value.copy).toBe(value.root)
    const written = dumpCalendarYaml(value)
    expect(written).toContain('day: 2032-04-05\n')
    const reread = load(written) as typeof value
    expect(reread.copy).toBe(reread.root)
    expect(reread.root.self).toBe(reread.root)
  })
})
