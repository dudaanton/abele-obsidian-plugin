import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { SourceMapConsumer } from 'source-map-js'
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
          /scale-observer|reindex\.cjs|diagnostics\.cjs/.test(f.url ?? '')
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
    const owner = !attributionPass ? 'unattributed' :
      (counts.abele || loaderSample) && (loadMarker || (loaderSample &&
        (!evalStarts.length || task.startedAt < Math.min(...evalStarts.map(row => row.at)))))
        ? 'plugin load' :
      counts.abele ? 'ours during sync' :
      !attributionPass ? 'unattributed' :
      counts.harness ? 'harness-triggered' :
      counts.host ? 'host-only' : 'unattributed'
    results.push({
      ...task,
      profiles: matches.map((c) => c.path),
      samplesBySource: counts,
      source: Object.keys(counts).length ? 'sampled' : 'unknown',
      frames,
      owner,
      attributionPass,
      profileWindowComplete,
      coverage: matches.some((capture) => capture.continuous)
        ? 'Continuous low-rate samples were armed before product load. Missing/censored segments and mixed stacks remain unknown.'
        : 'Tail samples only; the watchdog threshold and debugger command latency precede capture. Mixed stacks remain mixed, missing samples remain unknown.',
    })
  }
  return results
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
