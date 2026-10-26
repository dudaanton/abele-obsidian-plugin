import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import diagnostics from './diagnostics.cjs'
const exec = promisify(execFile)
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
export async function profileSummary(tasks, captures, load) {
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
    for (const capture of matches) {
      if (!cache.has(capture.path))
        cache.set(
          capture.path,
          load(capture.path).catch(() => null)
        )
      while (cache.size > 4) cache.delete(cache.keys().next().value)
      const profile = await cache.get(capture.path)
      if (!profile) continue
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
          if (node.callFrame?.url) stack.push(node.callFrame)
          node = nodes.get(parents.get(node.id))
        }
        const observerFrame = stack.findIndex((f) =>
          /scale-observer|reindex\.cjs|diagnostics\.cjs/.test(f.url)
        )
        const pluginFrame = stack.findIndex((f) => /plugin:abele(?:[/:]|$)/.test(f.url))
        const source =
          observerFrame >= 0 && (pluginFrame < 0 || observerFrame < pluginFrame)
            ? 'harness'
            : stack.length
              ? diagnostics.classifyOrigin(
                  stack.map((f) => `    at ${f.functionName} (${f.url}:1:1)`).join('\n')
                )
              : 'unknown'
        counts[source] = (counts[source] ?? 0) + 1
        if (frames.length < 20 && stack.length) frames.push({ source, stack })
      }
    }
    results.push({
      ...task,
      profiles: matches.map((c) => c.path),
      samplesBySource: counts,
      source: Object.keys(counts).length ? 'sampled' : 'unknown',
      frames,
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
