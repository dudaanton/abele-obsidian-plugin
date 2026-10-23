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
  }
}
export function sampleMemory(rootPid) {
  return exec('ps', ['-axo', 'pid=,ppid=,rss='], { maxBuffer: 4 * 1024 ** 2 }).then((r) =>
    rssSample(r.stdout, rootPid)
  )
}
export async function profileSummary(tasks, captures, load) {
  const cache = new Map()
  return Promise.all(
    tasks
      .filter((e) => e.event === 'long-task')
      .map(async (task) => {
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
            const source = stack.length
              ? diagnostics.classifyOrigin(
                  stack.map((f) => `    at ${f.functionName} (${f.url}:1:1)`).join('\n')
                )
              : 'unknown'
            counts[source] = (counts[source] ?? 0) + 1
            if (frames.length < 20 && stack.length) frames.push({ source, stack })
          }
        }
        return {
          ...task,
          profiles: matches.map((c) => c.path),
          samplesBySource: counts,
          source: Object.keys(counts).length ? 'sampled' : 'unknown',
          frames,
          coverage:
            'Tail samples only; the watchdog threshold and debugger command latency precede capture. Mixed stacks remain mixed, missing samples remain unknown.',
        }
      })
  )
}
