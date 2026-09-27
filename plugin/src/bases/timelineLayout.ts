/**
 * The history timeline's items and where they go: a note turned into a bar, a point or an era;
 * the bars of a row of the base packed into lines with their labels; what does not fit gathered
 * into "+N"; how many are alive at each point; who lived at the same time as whom. Pure, no
 * Obsidian and no drawing.
 */
import type { KitColor } from '@/constants/colors'
import { parseHistDate, parsePeriod, type HistDate, type HistParseOptions } from './historyDates'

export type TimelineKind = 'person' | 'event' | 'period' | 'era'

/**
 * How a bar ends: on its date, at today's line, fading out (a person born long ago whose death
 * the note does not give), or not at all — a point.
 */
export type TimelineEnd = 'known' | 'now' | 'fade' | 'none'

export interface TimelineItem {
  id: string
  path: string
  title: string
  /** The row of the view: the base's group, by its place in the grouping. */
  lane: number
  color: KitColor | null
  kind: TimelineKind
  start: HistDate
  end: HistDate | null
  ending: TimelineEnd
  /** Where the drawing begins and ends, soft edges included. */
  from: number
  to: number
  /** Where it is solid: from the end of a vague start to the beginning of a vague end. */
  solidFrom: number
  solidTo: number
  /** Which labels win when there is no room for all: the notes that link here. */
  weight: number
  /** A picture's URL, or null. */
  cover: string | null
}

/** A person with no death date born longer ago than this has an unknown end, not a life. */
export const LIVING_LIMIT = 120
/** How a life with an unknown end is drawn: solid this long, then fading out over as long again. */
const FADE_SOLID = 40
const FADE_LENGTH = 40

const KIND_WORDS: Record<string, TimelineKind> = {}
;(
  [
    ['person', ['person', 'people', 'human', 'человек', 'персона', 'личность', 'люди']],
    ['event', ['event', 'событие', 'события']],
    ['period', ['period', 'war', 'reign', 'период', 'война', 'правление']],
    ['era', ['era', 'epoch', 'age', 'эпоха', 'эра', 'эпохи']],
  ] as const
).forEach(([kind, words]) => words.forEach((w) => (KIND_WORDS[w] = kind)))

/** A kind written in a note — "человек", "war", "эпоха" — or null. */
export function kindOf(value: unknown): TimelineKind | null {
  if (typeof value !== 'string') return null
  return KIND_WORDS[value.trim().toLowerCase()] ?? null
}

export interface RawTimelineEntry {
  path: string
  title: string
  start: unknown
  end: unknown
  /** A whole span in one field, `1914–1918`. */
  period: unknown
  kind: unknown
  /** The start came from a birth property: without an end, this is a life, not an event. */
  born: boolean
  /** In the group the view draws as eras. */
  era: boolean
  lane: number
  color: KitColor | null
  weight: number
  cover: string | null
}

/** A note as the timeline draws it; null when it has no date to be placed by. */
export function toTimelineItem(raw: RawTimelineEntry, opts: HistParseOptions): TimelineItem | null {
  let start = parseHistDate(raw.start, opts)
  let end = parseHistDate(raw.end, opts)
  // A whole span in its own field fills in whatever the start and end fields leave out. A
  // range in the start field is different: that is a start that lies somewhere between.
  const whole = parsePeriod(raw.period, opts)
  if (whole) {
    start ??= whole.start
    end ??= whole.end
  } else start ??= parseHistDate(raw.period, opts)
  if (!start) return null
  if (end && end.hi < start.lo) end = null

  const written = kindOf(raw.kind)
  const kind: TimelineKind =
    raw.era || written === 'era'
      ? 'era'
      : (written ?? (end ? (raw.born ? 'person' : 'period') : raw.born ? 'person' : 'event'))

  let ending: TimelineEnd = 'none'
  let solidFrom = start.fuzzy ? start.hi : start.at
  let from = start.fuzzy ? start.lo : start.at
  let solidTo = solidFrom
  let to = start.fuzzy ? start.hi : start.at
  if (end) {
    ending = end.now ? 'now' : 'known'
    solidTo = end.fuzzy ? end.lo : end.at
    to = end.fuzzy ? end.hi : end.at
  } else if (kind === 'person') {
    if (opts.now - start.at > LIVING_LIMIT) {
      ending = 'fade'
      solidTo = start.at + FADE_SOLID
      to = solidTo + FADE_LENGTH
    } else {
      ending = 'now'
      solidTo = opts.now
      to = opts.now
    }
  } else if (start.fuzzy) {
    // "XVI век" for an event: a soft bracket over the whole century.
    solidFrom = solidTo = start.at
  }
  if (solidFrom > solidTo) solidFrom = solidTo = (solidFrom + solidTo) / 2
  from = Math.min(from, solidFrom)
  to = Math.max(to, solidTo)

  return {
    id: raw.path,
    path: raw.path,
    title: raw.title,
    lane: raw.lane,
    color: raw.color,
    kind,
    start,
    end,
    ending,
    from,
    to,
    solidFrom,
    solidTo,
    weight: raw.weight,
    cover: raw.cover,
  }
}

/** A point on the line, not a stretch: an event on one date. */
export const isPoint = (item: TimelineItem): boolean => item.ending === 'none' && !item.start.fuzzy

// ---- packing into lines ---------------------------------------------------------------------

export interface PackOptions {
  /** Pixels per year the layout is made at. */
  ppy: number
  /** Lines a row may take before what is left goes into "+N". */
  maxRows: number
  /** Space between two things on one line. */
  gapPx: number
  /** The width of a point's mark. */
  pointPx: number
  /** The narrowest a bar is drawn. */
  minBarPx: number
  /** Padding around a label inside its bar, and before one beside it. */
  padPx: number
  /** How wide a label is: the name, its dates and a picture, in pixels. */
  labelPx(item: TimelineItem): number
}

export interface Placement {
  line: number
  /** Whether its label is drawn: false leaves a bar that had no room for one. */
  labeled: boolean
}

export interface LanePack {
  placed: Map<TimelineItem, Placement>
  lines: number
  /** What did not fit, even without a label. */
  overflow: TimelineItem[]
}

/** The stretch an item takes on its line, in years, with its label or without. */
export function extentOf(item: TimelineItem, o: PackOptions, labeled: boolean): [number, number] {
  const px = 1 / o.ppy
  if (isPoint(item)) {
    const a = item.from - (o.pointPx / 2) * px
    const b = item.from + (o.pointPx / 2 + (labeled ? o.padPx + o.labelPx(item) : 0)) * px
    return [a, b]
  }
  const width = (item.to - item.from) * o.ppy
  const barEnd = item.from + Math.max(width, o.minBarPx) * px
  if (!labeled) return [item.from, barEnd]
  const label = o.labelPx(item)
  const inside = label + 2 * o.padPx <= width
  return [item.from, inside ? barEnd : barEnd + (o.padPx + label) * px]
}

/** Lines of stretches kept in order, each checked for room by a binary search. */
class Lines {
  private readonly lines: number[][] = []

  constructor(private readonly max: number) {}

  get count(): number {
    return this.lines.length
  }

  /** The first line with room for [a, b), or -1. */
  find(a: number, b: number): number {
    for (let i = 0; i < this.max; i++) {
      const line = this.lines[i]
      if (!line || this.free(line, a, b)) return i
    }
    return -1
  }

  take(i: number, a: number, b: number): void {
    while (this.lines.length <= i) this.lines.push([])
    const line = this.lines[i]
    let lo = 0
    let hi = line.length / 2
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (line[mid * 2] < a) lo = mid + 1
      else hi = mid
    }
    line.splice(lo * 2, 0, a, b)
  }

  private free(line: number[], a: number, b: number): boolean {
    // The first stretch that ends after `a` must start at or after `b`.
    let lo = 0
    let hi = line.length / 2
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (line[mid * 2 + 1] <= a) lo = mid + 1
      else hi = mid
    }
    return lo * 2 >= line.length || line[lo * 2] >= b
  }
}

function tryPack(o: PackOptions, order: TimelineItem[]): LanePack {
  const lines = new Lines(o.maxRows)
  const placed = new Map<TimelineItem, Placement>()
  const overflow: TimelineItem[] = []
  const gap = o.gapPx / o.ppy
  for (const item of order) {
    let labeled = true
    let [a, b] = extentOf(item, o, true)
    let line = lines.find(a, b + gap)
    if (line < 0) {
      labeled = false
      ;[a, b] = extentOf(item, o, false)
      line = lines.find(a, b + gap)
    }
    if (line < 0) {
      overflow.push(item)
      continue
    }
    lines.take(line, a, b + gap)
    placed.set(item, { line, labeled })
  }
  return { placed, lines: lines.count, overflow }
}

/**
 * A row's items laid in lines, first come first served by start — the staircase the eye reads
 * a century by — every label with its bar. When that takes more lines than a row may have, the
 * notes linked to most go first instead, so what does not fit is the least known.
 */
export function packLane(items: readonly TimelineItem[], o: PackOptions): LanePack {
  const byStart = [...items].sort((a, b) => a.from - b.from || b.to - a.to)
  const first = tryPack(o, byStart)
  if (first.overflow.length === 0 && ![...first.placed.values()].some((p) => !p.labeled))
    return first
  const byWeight = [...items].sort((a, b) => b.weight - a.weight || a.from - b.from)
  return tryPack(o, byWeight)
}

// ---- what does not fit ---------------------------------------------------------------------

export interface Cluster {
  /** Where its bubble stands. */
  t: number
  count: number
  from: number
  to: number
}

/** The notes left out of a row, gathered where they lie: one "+N" per `minPx` of screen. */
export function clusters(overflow: readonly TimelineItem[], ppy: number, minPx = 56): Cluster[] {
  const at = overflow.map((i) => (i.from + i.to) / 2).sort((a, b) => a - b)
  const out: Cluster[] = []
  const reach = minPx / ppy
  let sum = 0
  for (const t of at) {
    const last = out[out.length - 1]
    if (last && t - last.from < reach) {
      last.count++
      last.to = t
      sum += t
      last.t = sum / last.count
    } else {
      sum = t
      out.push({ t, count: 1, from: t, to: t })
    }
  }
  return out
}

/**
 * How many items are alive in each of `bins` equal stretches from `t0` to `t1`: a bar counts in
 * every stretch it touches, a point in the one it is in.
 */
export function density(
  items: readonly TimelineItem[],
  t0: number,
  t1: number,
  bins: number
): Float32Array {
  const out = new Float32Array(bins)
  if (bins <= 0 || t1 <= t0) return out
  const diff = new Float32Array(bins + 1)
  const k = bins / (t1 - t0)
  for (const item of items) {
    if (item.to < t0 || item.from > t1) continue
    const a = Math.max(0, Math.min(bins - 1, Math.floor((item.from - t0) * k)))
    // A bar ending where a stretch begins is not in that stretch; a point is in its own.
    const end = (item.to - t0) * k
    const b = Math.max(
      a,
      Math.min(bins - 1, item.to > item.from ? Math.ceil(end) - 1 : Math.floor(end))
    )
    diff[a]++
    diff[b + 1]--
  }
  let run = 0
  for (let i = 0; i < bins; i++) {
    run += diff[i]
    out[i] = run
  }
  return out
}

/** The items of a list sorted by `from` that reach into [t0, t1]; `longest` bounds the look back. */
export function visibleRange(
  sorted: readonly TimelineItem[],
  longest: number,
  t0: number,
  t1: number
): TimelineItem[] {
  let lo = 0
  let hi = sorted.length
  const from = t0 - longest
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid].from < from) lo = mid + 1
    else hi = mid
  }
  const out: TimelineItem[] = []
  for (let i = lo; i < sorted.length && sorted[i].from <= t1; i++)
    if (sorted[i].to >= t0) out.push(sorted[i])
  return out
}

// ---- contemporaries ------------------------------------------------------------------------

/** The years an item is counted over for "lived at the same time": null for an unknown end. */
export function lifeOf(item: TimelineItem): [number, number] | null {
  if (item.ending === 'fade') return null
  const start = item.start.at
  const end = item.end ? item.end.at : item.ending === 'now' ? item.to : start
  return [start, Math.max(start, end)]
}

export interface Together {
  item: TimelineItem
  /** Whole years both were alive, or both went on. */
  years: number
  /** One of the four dates is vague: the number is "about". */
  approx: boolean
}

/** Whether two items share any time: spans that overlap, or a point inside a span. */
export function overlaps(a: TimelineItem, b: TimelineItem): boolean {
  const la = lifeOf(a) ?? [a.from, a.to]
  const lb = lifeOf(b) ?? [b.from, b.to]
  return Math.min(la[1], lb[1]) >= Math.max(la[0], lb[0])
}

/**
 * Everyone whose span shares years with `selected`, most years together first — the list under
 * a picked person. Points are not in it: an event is not somebody's contemporary.
 */
export function together(selected: TimelineItem, items: readonly TimelineItem[]): Together[] {
  const mine = lifeOf(selected)
  if (!mine) return []
  const out: Together[] = []
  for (const item of items) {
    if (item === selected || item.ending === 'none' || item.kind === 'era') continue
    const theirs = lifeOf(item)
    if (!theirs) continue
    const years = Math.min(mine[1], theirs[1]) - Math.max(mine[0], theirs[0])
    if (years <= 0) continue
    const approx = [selected.start, selected.end, item.start, item.end].some((d) => d?.fuzzy)
    out.push({ item, years: Math.floor(years + 1e-9), approx })
  }
  return out.sort((a, b) => b.years - a.years || a.item.from - b.item.from)
}

/** How old a person was at `t`, or how long a period had gone on; null outside it. */
export function ageAt(item: TimelineItem, t: number): number | null {
  if (item.ending === 'none' || item.kind === 'era') return null
  if (t < item.start.at) return null
  const life = lifeOf(item)
  if (life && t > life[1] + 1) return null
  return Math.floor(t - item.start.at + 1e-9)
}
