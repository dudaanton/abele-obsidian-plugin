import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { SourceMapConsumer } from 'source-map-js'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import entryLedger from './entry-ledger.cjs'
const exec = promisify(execFile)
export function symbolizerFromMap(map) {
  const consumer = new SourceMapConsumer(map)
  const cache = new Map()
  return (frame) => {
    if (!/plugin:abele(?:[/:]|$)/.test(frame.url ?? '')) return frame
    const key = `${frame.lineNumber}:${frame.columnNumber}`
    let original = cache.get(key)
    if (!original) {
      original = consumer.originalPositionFor({ line: frame.lineNumber + 1,
        column: frame.columnNumber })
      cache.set(key, original)
    }
    return original?.source ? { ...frame, generatedName: frame.functionName,
      functionName: original.name ?? frame.functionName,
      originalSource: original.source, originalLine: original.line,
      originalName: original.name ?? frame.functionName } : frame
  }
}
export function noticeSummary(entries) {
  const counts = { host: 0, abele: 0, otherPlugin: 0, unknown: 0, total: 0 }
  for (const e of entries.filter((e) => e.event === 'notice')) {
    counts.total++
    counts[
      e.source === 'other-plugin'
        ? 'otherPlugin'
        : ['host', 'abele'].includes(e.source)
          ? e.source
          : 'unknown'
    ]++
  }
  return counts
}
export function deadlinePlan(startedAt) {
  if (!Number.isFinite(startedAt)) throw new Error('Worker start time required')
  return {
    workerStartedAt: startedAt,
    workerDeadlineAt: startedAt + 5 * 3600000,
    scenarioDeadlineAt: startedAt + 5 * 3600000 - 900000,
    cleanupReserveMs: 900000,
  }
}
export function rssSample(text, rootPid) {
  const rows = text
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((r) => r.length === 3 && r.every(Number.isFinite))
  if (!rows.some(([pid]) => pid === rootPid)) return null
  const own = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const [pid, parent] of rows)
      if (own.has(parent) && !own.has(pid)) {
        own.add(pid)
        changed = true
      }
  }
  const selected = rows.filter(([pid]) => own.has(pid))
  return {
    rssBytes: selected.reduce((sum, r) => sum + r[2] * 1024, 0),
    pids: selected.map((r) => r[0]).sort((a, b) => a - b),
    processes: selected.map(([pid, , rss]) => ({ pid, rssBytes: rss * 1024 })),
  }
}
export function sampleMemory(rootPid) {
  return exec('ps', ['-axo', 'pid=,ppid=,rss='], { maxBuffer: 4 * 1024 ** 2 }).then((r) =>
    rssSample(r.stdout, rootPid)
  )
}
export async function profileSummary(tasks, captures, load, symbolize = (frame) => frame) {
  const cache = new Map()
  const results = []
  for (const task of tasks.filter((e) => e.event === 'long-task')) {
    const matches = captures.filter(
      (c) =>
        c.event === 'cpu-profile' &&
        c.device === task.device &&
        c.startedAt < task.startedAt + task.durationMs &&
        c.endedAt > task.startedAt
    )
    const counts = {},
      frames = []
    let loaderSample = false
    const intervals = []
    for (const capture of matches) {
      if (!cache.has(capture.path))
        cache.set(
          capture.path,
          load(capture.path).catch(() => null)
        )
      while (cache.size > 4) cache.delete(cache.keys().next().value)
      const profile = await cache.get(capture.path)
      if (!profile) continue
      if (capture.clock && Number.isFinite(profile.startTime) && Number.isFinite(profile.endTime))
        intervals.push([
          capture.clock.afterAt + profile.startTime / 1000 - capture.clock.timestampMs,
          capture.clock.beforeAt + profile.endTime / 1000 - capture.clock.timestampMs,
        ])
      const nodes = new Map(profile.nodes.map((n) => [n.id, n])),
        parents = new Map()
      for (const node of profile.nodes)
        for (const child of node.children ?? []) parents.set(child, node.id)
      let elapsed = 0
      for (const [i, id] of (profile.samples ?? []).entries()) {
        elapsed += (profile.timeDeltas?.[i] ?? 0) / 1000
        // CDP acknowledgements may wait behind the task being sampled. Its monotonic
        // clock, calibrated before the watchdog starts, bounds sample wall times instead.
        const clock = capture.clock
        const at =
          clock && Number.isFinite(profile.startTime)
            ? clock.beforeAt + profile.startTime / 1000 - clock.timestampMs + elapsed
            : capture.startedAt + elapsed
        const latestAt =
          clock && Number.isFinite(profile.startTime)
            ? at + clock.afterAt - clock.beforeAt
            : Math.max(capture.startedAt, capture.startAcknowledgedAt ?? capture.startedAt) +
              elapsed
        if (at < task.startedAt || latestAt > task.startedAt + task.durationMs) continue
        const stack = []
        let node = nodes.get(id)
        const visited = new Set()
        while (node && !visited.has(node.id)) {
          visited.add(node.id)
          if (node.callFrame) stack.push(symbolize(node.callFrame))
          node = nodes.get(parents.get(node.id))
        }
        const observerFrame = stack.findIndex((f) =>
          /scale-observer|reindex\.cjs|diagnostics\.cjs|entry-ledger\.cjs/.test(f.url ?? '')
        )
        const pluginFrame = stack.findIndex((f) => /plugin:abele(?:[/:]|$)/.test(f.url ?? ''))
        loaderSample ||= stack.some(f => /loadPlugin|loadManifest/.test(f.functionName ?? ''))
        const source =
          observerFrame >= 0 && (pluginFrame < 0 || observerFrame < pluginFrame)
            ? 'harness'
            : pluginFrame >= 0 ? 'abele'
              : stack.some(f => /plugin:/.test(f.url ?? '')) ? 'other-plugin'
                : stack.some(f => /app:\/\/obsidian\.md\//.test(f.url ?? '')) ? 'host' : 'unknown'
        counts[source] = (counts[source] ?? 0) + 1
        if (stack.length && (frames.length < 20 || !frames.some(row => row.source === source)))
          frames.push({ source, stack })
      }
    }
    let coveredUntil = task.startedAt
    for (const [start, end] of intervals.sort((a, b) => a[0] - b[0]))
      if (start <= coveredUntil) coveredUntil = Math.max(coveredUntil, end)
    const profileWindowComplete = coveredUntil >= task.startedAt + task.durationMs
    const attributionPass = profileWindowComplete && frames.length > 0 && !counts.unknown &&
      !counts['other-plugin']
    const evalStarts = captures.filter(e => e.event === 'plugin-load-mark' &&
      e.name === 'abele:eval-start' && e.device === task.device)
    const loadMarker = evalStarts.length
      ? evalStarts.some(start => {
          const end = captures.find(e => e.event === 'plugin-load-mark' &&
            e.name === 'abele:eval-end' && e.device === task.device && e.at >= start.at)
          return task.startedAt < (end?.at ?? start.at + 60000) &&
            task.startedAt + task.durationMs > start.at
        })
      : captures.some(e => e.event === 'plugin-load' && e.device === task.device &&
          e.at >= task.startedAt && e.at <= task.startedAt + task.durationMs)
    let owner = !attributionPass ? 'unattributed' :
      (counts.abele || loaderSample) && (loadMarker || (loaderSample &&
        (!evalStarts.length || task.startedAt < Math.min(...evalStarts.map(row => row.at)))))
        ? 'plugin load' :
      counts.abele ? 'ours during sync' :
      !attributionPass ? 'unattributed' :
      counts.harness ? 'harness-triggered' :
      counts.host ? 'host-only' : 'unattributed'
    const ledger = entryLedgerEvidence(task, captures)
    const entryLedgerConflict = ledger.complete && ledger.overlapMs === 0 && Boolean(counts.abele)
    if (ledger.complete && ledger.overlapMs > 0)
      owner = loadMarker ? 'plugin load' : 'ours during sync'
    else if (entryLedgerConflict) owner = 'unattributed'
    else if (ledger.complete && ledger.harnessMs >= task.durationMs) owner = 'harness-triggered'
    else if (ledger.complete && ledger.lifecycle && owner === 'unattributed') owner = 'host-only'
    results.push({
      ...task,
      profiles: matches.map((c) => c.path),
      samplesBySource: counts,
      source: Object.keys(counts).length ? 'sampled' : 'unknown',
      frames,
      owner,
      attributionSource: ledger.complete && (ledger.overlapMs > 0 || ledger.lifecycle ||
        ledger.harnessMs >= task.durationMs)
        ? 'entry ledger' : 'CPU profile',
      entryLedgerComplete: ledger.complete,
      entryLedgerConflict,
      pluginEntryOverlapMs: ledger.overlapMs,
      entryLedgerOverheadMs: ledger.harnessMs,
      cpuAttributionPass: attributionPass,
      attributionPass: owner !== 'unattributed',
      profileWindowComplete,
      coverage: matches.some((capture) => capture.continuous)
        ? 'Continuous low-rate samples were armed before product load. Missing/censored segments and mixed stacks remain unknown.'
        : 'Tail samples only; the watchdog threshold and debugger command latency precede capture. Mixed stacks remain mixed, missing samples remain unknown.',
    })
  }
  return results
}

export function entryLedgerEvidence(task, evidence) {
  const end = task.startedAt + task.durationMs
  const rows = evidence.filter(row => row.device === task.device)
  const ready = rows.filter(row => row.event === 'plugin-entry-ledger-ready' &&
    row.complete && row.coverageStartedAt <= task.startedAt).sort((a, b) => b.at - a.at)[0]
  if (!ready) return { complete: false, overlapMs: 0, lifecycle: false }
  const generation = rows.filter(row => row.generation === ready.generation)
  const complete = generation.some(row => row.event === 'plugin-entry-ledger-checkpoint' &&
    row.complete && row.at >= end)
  if (!complete) return { complete: false, overlapMs: 0, lifecycle: false }
  const ends = new Map(generation.filter(row => row.event === 'plugin-entry-end').map(row => [row.id, row.at]))
  const spans = generation.filter(row => row.event === 'plugin-entry-start').map(row =>
    [Math.max(row.at, task.startedAt), Math.min(ends.get(row.id) ?? end, end)])
    .filter(([start, stop]) => stop > start).sort((a, b) => a[0] - b[0])
  const union = intervals => {
    let until = task.startedAt, total = 0
    for (const [start, stop] of intervals.sort((a, b) => a[0] - b[0])) {
      total += Math.max(0, stop - Math.max(until, start)); until = Math.max(until, stop)
    }
    return total
  }
  const overhead = generation.filter(row => row.event === 'plugin-entry-ledger-overhead')
    .map(row => [Math.max(task.startedAt, row.startedAt), Math.min(end, row.endedAt)])
    .filter(([start, stop]) => stop > start)
  const excluded = []
  for (const [start, stop] of spans) for (const [a, b] of overhead)
    if (Math.min(stop, b) > Math.max(start, a)) excluded.push([Math.max(start, a), Math.min(stop, b)])
  const overlapMs = Math.max(0, union(spans) - union(excluded))
  const evalStart = rows.find(row => row.event === 'plugin-load-mark' &&
    row.name === 'abele:eval-start' && row.at >= ready.at)
  const startup = ready.pluginAbsent && task.startedAt < (evalStart?.at ?? ready.at)
  const teardown = generation.some(row => row.event === 'renderer-lifecycle' &&
    row.kind === 'teardown' && row.at <= end)
  return { complete, overlapMs, harnessMs: union(overhead), lifecycle: startup || teardown }
}

// Keep the full ledger on disk, but retain only entries relevant to observed
// long tasks in the report. Large promise-job ledgers are streamed, not loaded.
export async function readEntryLedger(file, tasks) {
  const rows = [], active = new Map()
  let checkpoint, corrupted = false
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  for await (const line of lines) {
    let decoded
    try { decoded = entryLedger.decodeEntryBatch(JSON.parse(line)) } catch { corrupted = true; continue }
    for (const row of decoded) {
    if (row.event === 'plugin-entry-start') active.set(row.id, row)
    else if (row.event === 'plugin-entry-end') {
      const start = active.get(row.id)
      active.delete(row.id)
      if (start && (row.at - start.at > 50 || tasks.some(task => task.device === row.device &&
        start.at < task.startedAt + task.durationMs && row.at > task.startedAt))) rows.push(start, row)
    } else if (row.event === 'plugin-entry-ledger-checkpoint') checkpoint = row
    else rows.push(row)
    }
  }
  if (checkpoint) rows.push(checkpoint)
  for (const start of active.values()) if (tasks.some(task => task.device === start.device &&
    start.at < task.startedAt + task.durationMs)) rows.push(start)
  if (corrupted) for (const row of rows)
    if (row.event === 'plugin-entry-ledger-ready') row.complete = false
  return rows
}

// Accounting view only: paused debugger setup is still included in the raw task.
export function tracepointAdjustedTasks(tasks, setups) {
  return tasks.map((task) => {
    const start = task.startedAt,
      end = start + task.durationMs
    const intervals = setups
      .filter((s) => s.device === task.device)
      .map((s) => [Math.max(start, s.startedAt), Math.min(end, s.endedAt)])
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
      .sort((a, b) => a[0] - b[0])
    let covered = 0,
      until = start
    for (const [a, b] of intervals) {
      covered += Math.max(0, b - Math.max(a, until))
      until = Math.max(until, b)
    }
    return {
      ...task,
      tracepointSetupMs: covered,
      withoutTracepointSetupMs: task.durationMs - covered,
    }
  })
}
