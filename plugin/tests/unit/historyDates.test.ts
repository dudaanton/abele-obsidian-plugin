/**
 * Dates of history as people write them in a note's properties, read into years on one line.
 * One case per row of the table in the research note, plus the traps: no year zero, a negative
 * year read the human way, a range that is a whole span only in a field meant for one.
 */
import { describe, it, expect } from 'vitest'
import {
  astroYear,
  formatSpan,
  formatYear,
  humanYear,
  parseHistDate,
  parsePeriod,
  yearsBetween,
  type HistDate,
} from '@/bases/historyDates'

const NOW = 2026.74
const parse = (text: unknown, approx = 5) => parseHistDate(text, { approx, now: NOW })

/** The fields that matter, rounded so a day's fraction of a year compares plainly. */
const shape = (d: HistDate | null) =>
  d && {
    lo: Math.round(d.lo * 1000) / 1000,
    hi: Math.round(d.hi * 1000) / 1000,
    at: Math.round(d.at * 1000) / 1000,
    precision: d.precision,
    fuzzy: d.fuzzy,
  }

describe('years on one line', () => {
  it('has no year zero: 1 BC is followed by AD 1', () => {
    expect(astroYear(-1)).toBe(0)
    expect(astroYear(-490)).toBe(-489)
    expect(astroYear(1564)).toBe(1564)
    expect(humanYear(0)).toBe(-1)
    expect(humanYear(-489)).toBe(-490)
    expect(humanYear(14.5)).toBe(14)
  })
})

describe('a year, a month, a day', () => {
  it('reads a bare year, as a number too', () => {
    expect(shape(parse('1564'))).toEqual({
      lo: 1564,
      hi: 1565,
      at: 1564,
      precision: 'year',
      fuzzy: false,
    })
    expect(shape(parse(1564))).toEqual(shape(parse('1564')))
    expect(parse('1564 г.')?.at).toBe(1564)
    expect(parse('1564 год')?.at).toBe(1564)
    expect(parse('33')?.at).toBe(33)
  })

  it('reads a month and a day', () => {
    const month = parse('1564-04')!
    expect(month.precision).toBe('month')
    expect(month.lo).toBeCloseTo(1564 + 91 / 366, 3)
    expect(month.hi - month.lo).toBeCloseTo(30 / 366, 3)
    const day = parse('1564-04-26')!
    expect(day.precision).toBe('day')
    expect(day.at).toBeCloseTo(1564 + 116 / 366, 3)
    expect(parse('1564-04-26T10:30')?.precision).toBe('day')
  })

  it('reads a day written in words, Russian and English', () => {
    const iso = parse('1564-04-26')!.at
    expect(parse('26 апреля 1564')?.at).toBeCloseTo(iso, 6)
    expect(parse('26 April 1564')?.at).toBeCloseTo(iso, 6)
    expect(parse('April 26, 1564')?.at).toBeCloseTo(iso, 6)
    expect(parse('Apr 26 1564')?.at).toBeCloseTo(iso, 6)
    expect(parse('апрель 1564')?.precision).toBe('month')
    expect(parse('April 1564')?.precision).toBe('month')
    expect(parse('15 марта 44 до н.э.')?.precision).toBe('day')
    expect(Math.floor(parse('15 марта 44 до н.э.')!.at)).toBe(-43)
  })
})

describe('a decade, a century, a part of one', () => {
  it('reads a decade', () => {
    const expected = { lo: 1560, hi: 1570, at: 1565, precision: 'decade', fuzzy: true }
    expect(shape(parse('1560-е'))).toEqual(expected)
    expect(shape(parse('1560s'))).toEqual(expected)
    expect(shape(parse('1560-х'))).toEqual(expected)
    expect(shape(parse('156X'))).toEqual(expected)
  })

  it('reads a century, the 16th being 1501 to 1600', () => {
    const expected = { lo: 1501, hi: 1601, at: 1551, precision: 'century', fuzzy: true }
    for (const text of ['XVI век', '16 век', '16th c.', '16th century', 'XVI в.', 'XVI века'])
      expect(shape(parse(text)), text).toEqual(expected)
    expect(shape(parse('15XX'))).toEqual({
      lo: 1500,
      hi: 1600,
      at: 1550,
      precision: 'century',
      fuzzy: true,
    })
  })

  it('reads a century before Christ', () => {
    // The 5th century BC is 500 to 401 BC.
    const d = parse('V век до н.э.')!
    expect(d.lo).toBe(astroYear(-500))
    expect(d.hi).toBe(astroYear(-401) + 1)
    expect(shape(parse('5th century BC'))).toEqual(shape(d))
    expect(shape(parse('V в. до н. э.'))).toEqual(shape(d))
  })

  it('reads a third, a half and a quarter of a century', () => {
    const early = parse('начало XVI века')!
    expect(early.precision).toBe('part')
    expect(early.lo).toBe(1501)
    expect(early.hi).toBeCloseTo(1501 + 100 / 3, 6)
    expect(shape(parse('early 16th century'))).toEqual(shape(early))
    const mid = parse('середина XVI века')!
    expect(mid.lo).toBeCloseTo(1501 + 100 / 3, 6)
    expect(shape(parse('mid 16th century'))).toEqual(shape(mid))
    expect(parse('конец XVI века')!.hi).toBe(1601)
    expect(shape(parse('late 16th c.'))).toEqual(shape(parse('конец XVI века')))
    const second = parse('вторая половина XVI века')!
    expect([second.lo, second.hi]).toEqual([1551, 1601])
    expect(shape(parse('second half of the 16th century'))).toEqual(shape(second))
    expect([parse('первая половина XVI в.')!.lo, parse('первая половина XVI в.')!.hi]).toEqual([
      1501, 1551,
    ])
    expect([parse('первая четверть XVI века')!.lo, parse('первая четверть XVI века')!.hi]).toEqual([
      1501, 1526,
    ])
  })

  it('reads a millennium', () => {
    const d = parse('III тыс. до н.э.')!
    expect(d.precision).toBe('millennium')
    expect([d.lo, d.hi]).toEqual([astroYear(-3000), astroYear(-2001) + 1])
    expect(shape(parse('3rd millennium BC'))).toEqual(shape(d))
    expect([parse('2nd millennium')!.lo, parse('2nd millennium')!.hi]).toEqual([1001, 2001])
  })
})

describe('about, perhaps, somewhere between', () => {
  it('reads "about" as five years either way, or what the view says', () => {
    const expected = { lo: 1445, hi: 1456, at: 1450, precision: 'year', fuzzy: true }
    for (const text of ['ок. 1450', 'около 1450', '~1450', 'c. 1450', 'ca. 1450', 'circa 1450'])
      expect(shape(parse(text)), text).toEqual(expected)
    expect(shape(parse('1450~'))).toEqual(expected)
    expect(parse('ок. 1450')?.approx).toBe(true)
    expect([parse('ок. 1450', 10)!.lo, parse('ок. 1450', 10)!.hi]).toEqual([1440, 1461])
  })

  it('reads a question mark as about, and remembers it', () => {
    const d = parse('1450?')!
    expect(d.uncertain).toBe(true)
    expect([d.lo, d.hi, d.at]).toEqual([1445, 1456, 1450])
  })

  it('reads a range in one field as "somewhere between"', () => {
    const expected = { lo: 1440, hi: 1456, at: 1448, precision: 'range', fuzzy: true }
    expect(shape(parse('1440–1455'))).toEqual(expected)
    expect(shape(parse('1440..1455'))).toEqual(expected)
    expect(shape(parse('1440-1455'))).toEqual(expected)
    expect(shape(parse('1440 — 1455'))).toEqual(expected)
    // Not a range: a year and a month.
    expect(parse('1440-12')?.precision).toBe('month')
  })

  it('reads a range before Christ, the era written once at the end', () => {
    const d = parse('490–479 до н.э.')!
    expect([d.lo, d.hi]).toEqual([astroYear(-490), astroYear(-479) + 1])
  })
})

describe('before Christ', () => {
  it('reads the words and the minus sign alike', () => {
    const expected = shape(parse('490 до н.э.'))
    expect(expected?.at).toBe(-489)
    for (const text of ['490 BC', '490 BCE', '490 B.C.', '-490', '490 до н. э.', '490 г. до н.э.'])
      expect(shape(parse(text)), text).toEqual(expected)
    expect(shape(parse(-490))).toEqual(expected)
  })

  it('reads an explicit AD', () => {
    expect(parse('14 н.э.')?.at).toBe(14)
    expect(parse('AD 14')?.at).toBe(14)
    expect(parse('14 CE')?.at).toBe(14)
  })

  it('counts Augustus as 76 years, not 77', () => {
    expect(yearsBetween(parse('63 до н.э.')!, parse('14')!)).toBe(76)
    expect(yearsBetween(parse('-63')!, parse('14 н.э.')!)).toBe(76)
  })
})

describe('now', () => {
  it('reads now in both languages', () => {
    for (const text of ['сейчас', 'now', 'present', 'наст. время', 'по настоящее время']) {
      const d = parse(text)
      expect(d?.now, text).toBe(true)
      expect(d?.at).toBe(NOW)
    }
  })
})

describe('not a date', () => {
  it('turns down what it cannot read', () => {
    for (const text of ['', '   ', 'soon', 'Иван', '12345678', null, undefined, {}, '1564-13'])
      expect(parse(text), String(text)).toBeNull()
  })

  it('reads an Obsidian date value the way it is printed', () => {
    expect(parse('1564-04-26 00:00')?.precision).toBe('day')
  })
})

describe('a whole span in one field', () => {
  it('reads a period as its start and its end', () => {
    const p = parsePeriod('1914–1918', { approx: 5, now: NOW })!
    expect([p.start.at, p.end.at]).toEqual([1914, 1918])
    const bc = parsePeriod('499–449 до н.э.', { approx: 5, now: NOW })!
    expect([bc.start.at, bc.end.at]).toEqual([astroYear(-499), astroYear(-449)])
    const open = parsePeriod('1991 – present', { approx: 5, now: NOW })!
    expect(open.end.now).toBe(true)
    expect(parsePeriod('1914', { approx: 5, now: NOW })).toBeNull()
    const words = parsePeriod('с 1914 по 1918', { approx: 5, now: NOW })!
    expect([words.start.at, words.end.at]).toEqual([1914, 1918])
    // Each side keeps the way it was written, for the label.
    expect(parsePeriod('XVI век – 1620', { approx: 5, now: NOW })!.start.text).toBe('XVI век')
  })
})

describe('writing a year down', () => {
  it('writes years the way the app speaks', () => {
    expect(formatYear(1564, 'en')).toBe('1564')
    expect(formatYear(-489, 'en')).toBe('490 BC')
    expect(formatYear(-489, 'ru')).toBe('490 до н.э.')
    expect(formatYear(0.5, 'ru')).toBe('1 до н.э.')
  })

  it('writes a span the way it was written when it is not a plain year', () => {
    const p = (t: string) => parse(t)!
    expect(formatSpan(p('1564'), p('1616'), 'en')).toBe('1564–1616')
    expect(formatSpan(p('ок. 1450'), p('1516'), 'ru')).toBe('ок. 1450–1516')
    expect(formatSpan(p('-470'), p('-399'), 'ru')).toBe('470–399 до н.э.')
    expect(formatSpan(p('-63'), p('14'), 'en')).toBe('63 BC–14')
    expect(formatSpan(p('1564-04-26'), p('1616-04-23'), 'en')).toBe('1564–1616')
    expect(formatSpan(p('1453'), null, 'en')).toBe('1453')
    expect(formatSpan(p('1947'), p('now'), 'en')).toBe('1947–now')
  })
})
