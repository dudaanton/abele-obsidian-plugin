/**
 * Where everything on the history timeline goes, top to bottom: the axis, the strip of eras,
 * each row of the base with its lines of bars and, when it is crowded, its "+N" and its band of
 * density, and the overview at the foot. Worked out once per zoom bucket and per change of the
 * data or of the pick, not on every frame; the frame only reads it (`timelineDraw`).
 *
 * With someone picked the rows give way to one list: the picked one on top, everyone who lived
 * at the same time under it by year of birth, one line each, and the rest after them, dimmed.
 */
import type { TimelineLane } from '@/bases/TimelineView'
import {
  clusters,
  isPoint,
  lifeOf,
  overlaps,
  packLane,
  type Cluster,
  type LanePack,
  type PackOptions,
  type TimelineItem,
} from '@/bases/timelineLayout'

export interface Metrics {
  /** The column of row names on the left; none on a phone, where the names are chips. */
  labelW: number
  axisH: number
  eraH: number
  minimapH: number
  lineH: number
  barH: number
  /** Above a row's first line: room for its name on a phone, air on a computer. */
  laneHead: number
  laneFoot: number
  densityH: number
  bubbleH: number
  /** Lines a row may take before the rest go into "+N". */
  maxRows: number
}

export const DESKTOP: Metrics = {
  labelW: 140,
  axisH: 34,
  eraH: 24,
  minimapH: 36,
  lineH: 28,
  barH: 20,
  laneHead: 10,
  laneFoot: 10,
  densityH: 8,
  bubbleH: 24,
  maxRows: 40,
}

export const PHONE: Metrics = {
  labelW: 0,
  axisH: 30,
  eraH: 22,
  minimapH: 32,
  lineH: 26,
  barH: 18,
  laneHead: 22,
  laneFoot: 8,
  densityH: 8,
  bubbleH: 24,
  maxRows: 30,
}

export interface LaneBox {
  index: number
  lane: TimelineLane
  /** Its items by start, and the longest of them, to find what is on screen. */
  items: TimelineItem[]
  longest: number
  pack: LanePack
  clusters: Cluster[]
  /** From the top of the scrolled content. */
  top: number
  height: number
  linesTop: number
}

export interface Focus {
  selected: TimelineItem
  /** Lived at the same time, or happened within the picked life. */
  near: Set<TimelineItem>
  /** The line under the picked one where the dimmed rest begin. */
  restLine: number
}

export interface Scene {
  metrics: Metrics
  boxes: LaneBox[]
  eras: TimelineItem[]
  focus: Focus | null
  /** The line of the strip each era is drawn on, overlapping ones apart, and how many lines. */
  eraLines: Map<TimelineItem, number>
  eraRows: number
  /** Everything but the eras, by start: the overview's density. */
  all: TimelineItem[]
  contentH: number
}

const byFrom = (a: TimelineItem, b: TimelineItem) => a.from - b.from || b.to - a.to

const longestOf = (items: readonly TimelineItem[]) =>
  items.reduce((m, i) => Math.max(m, i.to - i.from), 0)

function laneBox(
  index: number,
  lane: TimelineLane,
  items: TimelineItem[],
  pack: LanePack,
  top: number,
  m: Metrics,
  ppy: number
): LaneBox {
  const found = pack.overflow.length ? clusters(pack.overflow, ppy) : []
  const extra = found.length ? m.bubbleH + m.densityH + 6 : 0
  const lines = Math.max(1, pack.lines)
  const height = m.laneHead + lines * m.lineH + extra + m.laneFoot
  return {
    index,
    lane,
    items,
    longest: longestOf(items),
    pack,
    clusters: found,
    top,
    height,
    linesTop: top + m.laneHead,
  }
}

/** The rows of the base, each packed at the bucket's zoom. */
export function buildScene(
  items: readonly TimelineItem[],
  lanes: readonly TimelineLane[],
  pack: Omit<PackOptions, 'maxRows'>,
  m: Metrics,
  selected: TimelineItem | null
): Scene {
  const eras = items.filter((i) => i.kind === 'era').sort(byFrom)
  const all = items.filter((i) => i.kind !== 'era').sort(byFrom)
  if (selected && selected.kind !== 'era' && !isPoint(selected) && lifeOf(selected))
    return focusScene(all, eras, pack, m, selected)

  const perLane: TimelineItem[][] = lanes.map((): TimelineItem[] => [])
  for (const item of all) (perLane[item.lane] ?? perLane[0]).push(item)
  const boxes: LaneBox[] = []
  let top = 0
  lanes.forEach((lane, i) => {
    const list = perLane[i]
    const packed = packLane(list, { ...pack, maxRows: m.maxRows })
    const box = laneBox(i, lane, list, packed, top, m, pack.ppy)
    boxes.push(box)
    top += box.height
  })
  return { metrics: m, boxes, eras, focus: null, all, contentH: top, ...eraLayout(eras) }
}

/**
 * The picked life on the first line, its contemporaries one to a line by start, and the rest
 * packed after a gap. Events inside the life stay bright among the rest.
 */
function focusScene(
  all: TimelineItem[],
  eras: TimelineItem[],
  pack: Omit<PackOptions, 'maxRows'>,
  m: Metrics,
  selected: TimelineItem
): Scene {
  const near = new Set<TimelineItem>()
  const contemporaries: TimelineItem[] = []
  const rest: TimelineItem[] = []
  for (const item of all) {
    if (item === selected) continue
    if (overlaps(selected, item)) near.add(item)
    if (near.has(item) && !isPoint(item) && item.ending !== 'none') contemporaries.push(item)
    else rest.push(item)
  }
  contemporaries.sort(byFrom)
  const placed = new Map<TimelineItem, { line: number; labeled: boolean }>()
  placed.set(selected, { line: 0, labeled: true })
  contemporaries.forEach((item, i) => placed.set(item, { line: i + 1, labeled: true }))
  const restLine = contemporaries.length + 2
  const packed = packLane(rest, { ...pack, maxRows: m.maxRows })
  for (const [item, p] of packed.placed)
    placed.set(item, { line: p.line + restLine, labeled: p.labeled })
  const merged: LanePack = {
    placed,
    lines: restLine + packed.lines,
    overflow: packed.overflow,
  }
  const lane: TimelineLane = { label: '', color: null, count: all.length }
  const box = laneBox(
    0,
    lane,
    [selected, ...contemporaries, ...rest].sort(byFrom),
    merged,
    0,
    m,
    pack.ppy
  )
  return {
    metrics: m,
    boxes: [box],
    eras,
    focus: { selected, near, restLine },
    ...eraLayout(eras),
    all,
    contentH: box.height,
  }
}

/** The most lines the strip of eras takes; an era past them shares the last. */
const MAX_ERA_ROWS = 3

/** Eras that overlap in time — the Renaissance and the Middle Ages — on lines of their own. */
function eraLayout(eras: readonly TimelineItem[]): {
  eraLines: Map<TimelineItem, number>
  eraRows: number
} {
  const ends: number[] = []
  const eraLines = new Map<TimelineItem, number>()
  for (const era of eras) {
    let line = ends.findIndex((end) => end <= era.from)
    if (line < 0) line = ends.length < MAX_ERA_ROWS ? ends.length : MAX_ERA_ROWS - 1
    ends[line] = Math.max(ends[line] ?? -Infinity, era.to)
    eraLines.set(era, line)
  }
  return { eraLines, eraRows: ends.length }
}

/** Something drawn that can be pressed, as the frame left it. */
export type Hit =
  | { kind: 'item'; item: TimelineItem; x: number; y: number; w: number; h: number }
  | { kind: 'cluster'; cluster: Cluster; x: number; y: number; w: number; h: number }
  | { kind: 'era'; item: TimelineItem; x: number; y: number; w: number; h: number }

/** The topmost thing under a point, a little forgiving for a finger. */
export function hitAt(hits: readonly Hit[], x: number, y: number, slop = 0): Hit | null {
  let best: Hit | null = null
  let bestD = Infinity
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i]
    const dx = x < h.x ? h.x - x : x > h.x + h.w ? x - h.x - h.w : 0
    const dy = y < h.y ? h.y - y : y > h.y + h.h ? y - h.y - h.h : 0
    const d = Math.hypot(dx, dy)
    if (d === 0) return h
    if (d <= slop && d < bestD) {
      best = h
      bestD = d
    }
  }
  return best
}
