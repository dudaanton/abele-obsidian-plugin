// From what the node answers about runs to what the trace views draw. Pure, so the views'
// shapes are tested without a node or Obsidian.
import type { DebugBreakpoint } from '@/components/debugger/types'
import { formatFrameName } from '@/components/debugger/stackFormat'
import type {
  ShapeNode,
  TraceRecording,
  TraceRun,
  TraceRunSummary,
  TraceStep,
  TraceTrail,
  TraceValue,
} from '@/components/debugger/trace/types'
import type {
  WirePoint,
  WireRun,
  WireRunPoint,
  WireRunSummary,
  WireShape,
  WireStatus,
  WireStep,
  WireTrail,
  WireValue,
} from './wire'

/** `0.4 s`, `12 s`, `1:42`. */
export function lengthWords(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const runLength = (r: WireRunSummary, now: number) =>
  lengthWords(r.length_ms ?? (r.state === 'recording' ? now - Date.parse(r.started_at) : undefined))

export const runName = (r: WireRunSummary): string =>
  r.name === r.started_at.replace('T', ' ').slice(0, 19)
    ? new Date(r.started_at).toLocaleString()
    : r.name

const frameName = (raw: string): string => {
  const { name, receiver } = formatFrameName(raw)
  return receiver ? `${receiver}.${name}` : name
}

export const runSummary = (r: WireRunSummary, now = Date.now()): TraceRunSummary => ({
  id: r.id,
  name: runName(r),
  steps: r.steps,
  length: runLength(r, now),
  ...(r.state === 'cut' ? { cut: true } : {}),
})

/** The recording group while a run is written. Browser requests are not recorded yet. */
export function recording(status: WireStatus, now = Date.now()): TraceRecording | undefined {
  if (!status.recording) return undefined
  const elapsed = Math.max(0, now - Date.parse(status.recording.started_at))
  const s = Math.floor(elapsed / 1000)
  return {
    elapsed: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`,
    steps: status.recording.steps,
    browser: { state: 'none', via: 'chrome', hosts: [] },
    folder: status.folder,
  }
}

export const shape = (w: WireShape): ShapeNode => ({
  ...(w.key !== undefined ? { key: w.key } : {}),
  type: w.type,
  ...(w.count !== undefined ? { count: w.count } : {}),
  ...(w.optional ? { optional: true } : {}),
  ...(w.example !== undefined ? { example: w.example } : {}),
  ...(w.children ? { children: w.children.map(shape) } : {}),
})

export const value = (v: WireValue): TraceValue => ({
  name: v.name,
  brief: v.brief,
  bytes: v.bytes,
  format: v.format,
  ...(v.same ? { same: true } : {}),
  ...(v.masked ? { masked: true } : {}),
  ...(v.failed ? { failed: v.failed } : {}),
})

export const step = (s: WireStep): TraceStep => ({
  id: s.id,
  kind: s.kind,
  at: s.at,
  label: s.place?.fn ? s.label.replace(s.place.fn, frameName(s.place.fn)) : s.label,
  ...(s.place
    ? { place: { ...s.place, ...(s.place.fn ? { fn: frameName(s.place.fn) } : {}) } }
    : {}),
  ...(s.stack ? { stack: s.stack.map(frameName) } : {}),
  ...(s.paused_ms !== undefined ? { pausedMs: Math.round(s.paused_ms) } : {}),
  ...(s.direction ? { direction: s.direction } : {}),
  ...(s.duration_ms !== undefined ? { durationMs: s.duration_ms } : {}),
  ...(s.status !== undefined ? { status: s.status } : {}),
  ...(s.host ? { host: s.host } : {}),
  ...(s.chain ? { chain: s.chain } : {}),
  ...(s.by_time ? { byTime: true } : {}),
  ...(s.sent ? { sent: true } : {}),
  ...(s.marked ? { marked: true } : {}),
  values: s.values.map(value),
})

export const run = (w: WireRun, now = Date.now()): TraceRun => ({
  id: w.run.id,
  name: runName(w.run),
  length: runLength(w.run, now),
  steps: w.steps.map(step),
  ...(w.run.state === 'cut' ? { cut: true } : {}),
})

export const trail = (w: WireTrail): TraceTrail => ({
  value: w.value,
  stops: w.stops.map((s) => ({
    step: s.step,
    path: s.path,
    ...(s.change ? { change: s.change } : {}),
  })),
  ...(w.lost_after ? { lostAfter: w.lost_after } : {}),
})

/** A breakpoint the session knows, by the identity the node gave it. */
export interface KnownBreakpoint extends DebugBreakpoint {
  id: string
  condition?: string
}

/** Ordinary breakpoints stay as they are; a record point says what it takes, why it is there,
 * and from the newest run how often it fired and what it took the last time. */
export function decorate(
  breakpoints: KnownBreakpoint[],
  points: WirePoint[],
  latest?: WireRunPoint[]
): DebugBreakpoint[] {
  const byId = new Map(points.map((p) => [p.breakpoint_id, p]))
  const ran = new Map((latest ?? []).map((p) => [p.breakpoint_id, p]))
  return breakpoints.map(({ id, condition, ...b }) => {
    const p = byId.get(id)
    if (!p) return { ...b, ...(condition ? { condition } : {}) }
    const r = ran.get(id)
    return {
      ...b,
      kind: 'record',
      take: p.take,
      ...(condition ? { when: condition } : {}),
      ...(p.note ? { note: p.note } : {}),
      ...(r ? { hits: r.hits } : {}),
      ...(r?.last ? { last: r.last } : {}),
    }
  })
}
