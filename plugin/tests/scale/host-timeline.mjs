import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { appendFile } from 'node:fs/promises'
import { loadavg } from 'node:os'
import { performance } from 'node:perf_hooks'
const exec = promisify(execFile)

// Collect outside Electron. Persist numeric scheduling data, never process argv.
export function parseProcessTimeline(text, rootPid) {
  const rows = text.trim().split('\n').flatMap(line => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/)
    return m ? [{ pid: +m[1], parentPid: +m[2], state: m[3],
      cpuMs: ((+m[4] || 0) * 86400 + (+m[5] || 0) * 3600 + +m[6] * 60 + +m[7]) * 1000 }] : []
  })
  const owned = new Set([rootPid])
  for (let i = 0; i < rows.length; i++)
    for (const row of rows) if (owned.has(row.parentPid)) owned.add(row.pid)
  return rows.filter(row => owned.has(row.pid))
}

export function schedulingEvidence(task, rows) {
  const end = task.startedAt + task.durationMs
  const before = rows.filter(x => x.at <= task.startedAt).at(-1)
  const after = rows.find(x => x.at >= end)
  if (!before || !after) return { reason: 'external-timeline-gap', complete: false }
  const window = rows.filter(x => x.at >= before.at && x.at <= after.at)
  if (window.some((x, i) => i && x.at - window[i - 1].at > 750) ||
      window.some(x => x.unavailable || !x.processes?.length))
    return { reason: 'external-timeline-gap', complete: false }
  const stopped = window.every(x => x.processes.length >= 2 &&
    x.processes.every(p => p.state.startsWith('T')))
  return { reason: stopped ? 'shared-observed-process-stop' : 'no-proven-process-stop',
    complete: true, samples: window.length,
    cpu: before.processes.map(p => ({ pid: p.pid,
      deltaMs: after.processes.find(x => x.pid === p.pid)?.cpuMs - p.cpuMs })),
    // Discrete process observations diagnose a sampling gap; they do not replace
    // whole-task CPU ownership proof or negate a sampled plugin frame.
    ownershipProof: false }
}

export function startHostTimeline(rootPid, file, { execute = exec, intervalMs = 250 } = {}) {
  let pending, stopped = false
  const sample = () => {
    if (pending || stopped) return
    const at = Date.now(), monotonicMs = performance.now()
    pending = execute('/bin/ps', ['-axo', 'pid=,ppid=,state=,time='],
      { timeout: 1000, maxBuffer: 4 * 1024 ** 2 })
      .then(({ stdout }) => ({ event: 'host-process-sample', at,
        endedAt: Date.now(), monotonicMs, load: loadavg(),
        processes: parseProcessTimeline(stdout, rootPid) }))
      .catch(() => ({ event: 'host-process-sample', at, endedAt: Date.now(),
        monotonicMs, unavailable: true, category: 'process-sample-unavailable' }))
      .then(row => appendFile(file, JSON.stringify(row) + '\n'))
      .finally(() => { pending = undefined })
    // A failed evidence write must remain visible to stop(), not be unhandled.
    pending.catch(() => {})
  }
  sample()
  const timer = setInterval(sample, intervalMs)
  return async () => { stopped = true; clearInterval(timer); await pending }
}
