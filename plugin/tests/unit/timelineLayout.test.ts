/**
 * The history timeline's layout: notes turned into bars, points and eras; bars packed into
 * lines with their labels; what does not fit gathered into "+N"; how many are alive where; who
 * lived at the same time; and the axis — its ticks and its zoom limits.
 */
import { describe, it, expect } from 'vitest'
import {
  ageAt,
  clusters,
  density,
  extentOf,
  isPoint,
  kindOf,
  packLane,
  toTimelineItem,
  together,
  visibleRange,
  type PackOptions,
  type RawTimelineEntry,
  type TimelineItem,
} from '@/bases/timelineLayout'
import {
  nearestLevel,
  levelPpy,
  roundToStep,
  ticks,
  zoomAt,
  zoomLimits,
  tToX,
  zoomBucket,
  bucketPpy,
} from '@/bases/timelineScale'
import { astroYear } from '@/bases/historyDates'

const NOW = 2026.74
const OPTS = { approx: 5, now: NOW }

const raw = (over: Partial<RawTimelineEntry>): RawTimelineEntry => ({
  path: `${over.title ?? 'x'}.md`,
  title: 'x',
  start: null,
  end: null,
  period: null,
  kind: null,
  born: false,
  era: false,
  lane: 0,
  color: null,
  weight: 0,
  cover: null,
  ...over,
})

const item = (over: Partial<RawTimelineEntry>): TimelineItem => toTimelineItem(raw(over), OPTS)!

describe('a note on the timeline', () => {
  it('is a bar with a start and an end, a point with only a start', () => {
    const war = item({ title: 'War', start: '1618', end: '1648' })
    expect([war.kind, war.ending, war.from, war.to]).toEqual(['period', 'known', 1618, 1648])
    const battle = item({ title: 'Battle', start: '1453' })
    expect([battle.kind, battle.ending]).toEqual(['event', 'none'])
    expect(isPoint(battle)).toBe(true)
  })

  it('has nothing to be placed by without a date', () => {
    expect(toTimelineItem(raw({ start: 'soon' }), OPTS)).toBeNull()
  })

  it('takes a whole span from a period field', () => {
    const war = item({ period: '1914–1918' })
    expect([war.start.at, war.end?.at]).toEqual([1914, 1918])
    const bc = item({ period: '499–449 до н.э.' })
    expect(bc.from).toBe(astroYear(-499))
  })

  it('reads a range in the start field as a vague start, not a span', () => {
    const bosch = item({ start: '1440–1455', end: '1516', born: true })
    expect(bosch.from).toBe(1440)
    expect(bosch.solidFrom).toBe(1456)
    expect(bosch.to).toBe(1516)
    expect(bosch.kind).toBe('person')
  })

  it('draws a person with no death as alive when born lately, fading when born long ago', () => {
    const alive = item({ start: '1960', born: true })
    expect([alive.ending, alive.to]).toEqual(['now', NOW])
    const homer = item({ start: 'ок. 800 до н.э.', born: true })
    expect(homer.ending).toBe('fade')
    expect(homer.to).toBeGreaterThan(homer.solidTo)
  })

  it('goes on to today for "now"', () => {
    const e = item({ start: '1991', end: 'present' })
    expect([e.ending, e.to]).toEqual(['now', NOW])
  })

  it('knows eras by the group or by what the note says it is', () => {
    expect(item({ start: '1300', end: '1600', era: true }).kind).toBe('era')
    expect(item({ start: '1300', end: '1600', kind: 'эпоха' }).kind).toBe('era')
    expect(kindOf('Человек')).toBe('person')
    expect(kindOf('war')).toBe('period')
    expect(kindOf('whatever')).toBeNull()
  })

  it('draws a vague event over its whole stretch', () => {
    const e = item({ start: 'XVI век' })
    expect([e.from, e.to]).toEqual([1501, 1601])
    expect(isPoint(e)).toBe(false)
  })

  it('drops an end before the start', () => {
    expect(item({ start: '1600', end: '1500' }).end).toBeNull()
  })
})

const PACK: PackOptions = {
  ppy: 10,
  maxRows: 3,
  gapPx: 4,
  pointPx: 10,
  minBarPx: 3,
  padPx: 6,
  labelPx: (i) => i.title.length * 7,
}

describe('packing a row into lines', () => {
  it('puts bars that do not touch on one line, and the next one below', () => {
    const a = item({ title: 'A', start: '1500', end: '1550' })
    const b = item({ title: 'B', start: '1560', end: '1600' })
    const c = item({ title: 'C', start: '1520', end: '1580' })
    const pack = packLane([a, b, c], PACK)
    expect(pack.placed.get(a)?.line).toBe(0)
    expect(pack.placed.get(b)?.line).toBe(0)
    expect(pack.placed.get(c)?.line).toBe(1)
    expect(pack.lines).toBe(2)
    expect(pack.overflow).toEqual([])
  })

  it('keeps room for a label beside a bar too short to hold it', () => {
    const short = item({ title: 'A rather long name', start: '1500', end: '1502' })
    const next = item({ title: 'B', start: '1510', end: '1520' })
    const [, b] = extentOf(short, PACK, true)
    expect(b).toBeGreaterThan(1502 + (PACK.padPx + 18 * 7) / PACK.ppy - 1e-9)
    const pack = packLane([short, next], PACK)
    expect(pack.placed.get(next)?.line).toBe(1)
  })

  it('gives the lines to the notes linked to most when there is no room for all', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      item({ title: `P${i}`, start: '1500', end: '1600', weight: i })
    )
    const pack = packLane(many, PACK)
    expect(pack.lines).toBe(3)
    expect(pack.overflow.map((i) => i.title).sort()).toEqual(['P0', 'P1', 'P2'])
  })

  it('draws a bar without its label rather than not at all', () => {
    const o = { ...PACK, maxRows: 1 }
    const a = item({ title: 'Long enough name', start: '1500', end: '1501', weight: 5 })
    const b = item({ title: 'B', start: '1504', end: '1510' })
    const pack = packLane([a, b], o)
    expect(pack.placed.get(a)).toEqual({ line: 0, labeled: true })
    expect(pack.overflow).toEqual([b])
    // Its label would run into a better-known bar: the bar stays, the label goes.
    const x = item({ title: 'X', start: '1530', end: '1540', weight: 9 })
    const y = item({ title: 'A name much too long to fit', start: '1500', end: '1520', weight: 1 })
    const tight = packLane([x, y], o)
    expect(tight.placed.get(x)).toEqual({ line: 0, labeled: true })
    expect(tight.placed.get(y)).toEqual({ line: 0, labeled: false })
  })

  // A loose bound, as the calendar's: ten thousand bars take a tenth of a second alone, a second
  // on a machine running several checks at once, and far longer if the packing went quadratic.
  it('packs thousands of bars without going quadratic', () => {
    const many = Array.from({ length: 10000 }, (_, i) =>
      item({ title: `Person ${i}`, start: String(1000 + (i % 900)), end: String(1060 + (i % 900)) })
    )
    const started = performance.now()
    const pack = packLane(many, { ...PACK, ppy: 2, maxRows: 40 })
    expect(pack.placed.size + pack.overflow.length).toBe(10000)
    expect(performance.now() - started).toBeLessThan(5000)
  }, 30_000)
})

describe('what does not fit', () => {
  it('is gathered into one "+N" per stretch of screen', () => {
    const left = [1500, 1501, 1502].map((y) => item({ start: String(y) }))
    const right = [1600, 1603].map((y) => item({ start: String(y) }))
    const found = clusters([...left, ...right], 1, 56)
    expect(found.map((c) => c.count)).toEqual([3, 2])
  })

  it('counts who is alive at each point', () => {
    const a = item({ start: '1500', end: '1600' })
    const b = item({ start: '1550', end: '1650' })
    // A bar that ends where a stretch begins is not in it.
    const d = density([a, b], 1400, 1700, 3)
    expect(Array.from(d)).toEqual([0, 2, 1])
  })

  it('finds what is on screen from a list sorted by start', () => {
    const list = [
      item({ title: 'a', start: '1000', end: '1100' }),
      item({ title: 'b', start: '1300', end: '1500' }),
      item({ title: 'c', start: '1600', end: '1610' }),
    ]
    expect(visibleRange(list, 200, 1450, 1620).map((i) => i.title)).toEqual(['b', 'c'])
    expect(visibleRange(list, 200, 1101, 1299)).toEqual([])
  })
})

describe('contemporaries', () => {
  const shakespeare = item({ title: 'Shakespeare', start: '1564', end: '1616', born: true })
  const galileo = item({ title: 'Galileo', start: '1564', end: '1642', born: true })
  const bacon = item({ title: 'Bacon', start: '1561', end: '1626', born: true })
  const kepler = item({ title: 'Kepler', start: '1571', end: '1630', born: true })
  const dante = item({ title: 'Dante', start: '1265', end: '1321', born: true })
  const armada = item({ title: 'Armada', start: '1588' })

  it('lists who lived at the same time, most years together first', () => {
    const list = together(shakespeare, [galileo, bacon, kepler, dante, armada])
    expect(list.map((t) => [t.item.title, t.years])).toEqual([
      ['Bacon', 52],
      ['Galileo', 52],
      ['Kepler', 45],
    ])
  })

  it('says "about" when a date is vague', () => {
    const bosch = item({ title: 'Bosch', start: 'ок. 1450', end: '1516', born: true })
    const leonardo = item({ title: 'Leonardo', start: '1452', end: '1519', born: true })
    expect(together(leonardo, [bosch])[0]).toMatchObject({ years: 64, approx: true })
  })

  it('tells an age at a year', () => {
    expect(ageAt(shakespeare, 1588.5)).toBe(24)
    expect(ageAt(shakespeare, 1500)).toBeNull()
    expect(ageAt(armada, 1588)).toBeNull()
  })
})

describe('the axis', () => {
  it('ticks years the human way, with no year zero', () => {
    const t = ticks(astroYear(-1000), 2000, 0.2, 'en')
    expect(t.step).toBe(500)
    expect(t.major.map((m) => m.label)).toEqual([
      '1000 BC',
      '500 BC',
      '1',
      '500',
      '1000',
      '1500',
      '2000',
    ])
  })

  it('ticks centuries in Russian', () => {
    const t = ticks(astroYear(-300), 300, 1, 'ru')
    expect(t.major.map((m) => m.label)).toContain('200 до н.э.')
  })

  it('ticks months and days when zoomed that far', () => {
    const months = ticks(1564, 1565, 1200, 'en')
    expect(months.major.map((m) => m.label).slice(0, 3)).toEqual(['1564', 'Feb', 'Mar'])
    const days = ticks(1564 + 90 / 366, 1564 + 100 / 366, 40000, 'en')
    expect(days.major.map((m) => m.label).slice(0, 2)).toEqual(['31 Mar', '1 Apr'])
  })

  it('zooms about a point, keeping it under the pointer', () => {
    const v = { t0: 1500, ppy: 2 }
    const z = zoomAt(v, 100, 8)
    expect(tToX(z, 1550)).toBeCloseTo(100, 6)
  })

  it('names the nearest step and limits the zoom by the data', () => {
    expect(nearestLevel(levelPpy('decades', 1000), 1000)).toBe('decades')
    const [min, max] = zoomLimits(1000, [1400, 1700], 'year')
    expect(1000 / min).toBeGreaterThanOrEqual(300 * 1.4 - 1e-6)
    expect(1000 / max).toBe(5)
    expect(zoomLimits(1000, [1400, 1700], 'day')[1]).toBeGreaterThan(max)
  })

  it('makes the layout at the bottom of its zoom bucket', () => {
    const ppy = 13
    expect(bucketPpy(zoomBucket(ppy))).toBeLessThanOrEqual(ppy)
    expect(bucketPpy(zoomBucket(ppy)) * Math.SQRT2).toBeGreaterThan(ppy)
  })

  it('rounds a new note to the step of the axis', () => {
    expect(roundToStep(1512.4, 10)).toBe(1510)
    expect(roundToStep(astroYear(-487), 10)).toBe(-490)
    expect(roundToStep(1512.4, 1)).toBe(1512)
  })
})
