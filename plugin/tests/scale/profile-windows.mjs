import { writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readEvidenceJson } from './evidence.mjs'

const plugin = (url) => /^plugin:abele(?:[/:]|$)/.test(url)

// Weighted sample intervals estimate sampled wall time, not CPU accounting or I/O
// service time. A missing URL is recoverable only within the same profile/script ID.
export function summarizeProfile(profile, capture, window) {
  const clock = capture.clock
  if (
    !clock ||
    ![clock.beforeAt, clock.afterAt, clock.timestampMs, profile.startTime].every(Number.isFinite)
  )
    throw new Error('A calibrated profile clock is required')
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const parents = new Map(),
    urls = new Map()
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) parents.set(child, node.id)
    const frame = node.callFrame
    if (frame?.url && frame.scriptId !== '0') urls.set(frame.scriptId, frame.url)
  }
  const frameOf = (node) => ({
    ...node.callFrame,
    url: node.callFrame.url || urls.get(node.callFrame.scriptId) || '',
  })
  const result = {
    sampledMs: 0,
    pluginStackMs: 0,
    categories: {},
    functions: {},
    leaves: {},
    leafOwners: {},
    nativeCallers: {},
    clockUncertaintyMs: clock.afterAt - clock.beforeAt,
  }
  let at = clock.beforeAt + profile.startTime / 1000 - clock.timestampMs
  for (const [index, id] of (profile.samples ?? []).entries()) {
    const delta = profile.timeDeltas?.[index] / 1000
    if (!Number.isFinite(delta) || delta < 0) throw new Error('Invalid profile sample timing')
    const end = at + delta
    const weight = Math.max(0, Math.min(end, window.end) - Math.max(at, window.start))
    at = end
    if (!weight) continue
    const chain = [],
      visited = new Set()
    let node = nodes.get(id)
    if (!node) throw new Error('Profile sample refers to a missing node')
    while (node && !visited.has(node.id)) {
      visited.add(node.id)
      chain.push(frameOf(node))
      node = nodes.get(parents.get(node.id))
    }
    const leaf = chain[0],
      name = leaf.functionName || '(anonymous)'
    const category =
      name === '(idle)'
        ? 'idle'
        : name === '(garbage collector)'
          ? 'gc'
          : /scale-observer|reindex\.cjs|diagnostics\.cjs/.test(leaf.url)
            ? 'harness'
            : plugin(leaf.url)
              ? 'plugin'
              : leaf.url.startsWith('app:')
                ? 'host'
                : leaf.url.startsWith('node:') || (!leaf.url && !name.startsWith('('))
                  ? 'native'
                  : 'unknown'
    result.sampledMs += weight
    result.categories[category] = (result.categories[category] ?? 0) + weight
    const leafKey = `${category}:${name}`
    result.leaves[leafKey] = (result.leaves[leafKey] ?? 0) + weight
    const ownerFrame = chain.find((frame) =>
      /scale-observer|reindex\.cjs|diagnostics\.cjs|^plugin:abele(?:[/:]|$)|^app:/.test(frame.url)
    )
    const owner = !ownerFrame
      ? category
      : plugin(ownerFrame.url)
        ? 'plugin'
        : ownerFrame.url.startsWith('app:')
          ? 'host'
          : 'harness'
    const ownerKey = `${owner}:${name}`
    result.leafOwners[ownerKey] = (result.leafOwners[ownerKey] ?? 0) + weight
    if (category === 'native' && ownerFrame) {
      const caller = `${name} <- ${owner}:${ownerFrame.functionName || '(anonymous)'}:${ownerFrame.lineNumber}`
      result.nativeCallers[caller] = (result.nativeCallers[caller] ?? 0) + weight
    }
    if (chain.some((frame) => plugin(frame.url))) result.pluginStackMs += weight
    const seen = new Set()
    for (const [depth, frame] of chain.entries()) {
      if (!plugin(frame.url)) continue
      const key = frame.functionName || '(anonymous)'
      const row = (result.functions[key] ??= { selfMs: 0, totalMs: 0, positions: [] })
      if (depth === 0) row.selfMs += weight
      if (!seen.has(key)) row.totalMs += weight
      seen.add(key)
      const position = `${frame.lineNumber ?? -1}:${frame.columnNumber ?? -1}`
      if (!row.positions.includes(position)) row.positions.push(position)
    }
  }
  return result
}

export async function analyzeWindows(captures, directory, windows, load = readEvidenceJson) {
  const output = windows.map((window) => ({
    ...window,
    sampledMs: 0,
    pluginStackMs: 0,
    categories: {},
    functions: {},
    leaves: {},
    leafOwners: {},
    nativeCallers: {},
    profiles: [],
    profileFailures: [],
    maxClockUncertaintyMs: 0,
  }))
  const seen = new Set()
  for (const capture of captures) {
    if (seen.has(capture.path)) continue
    seen.add(capture.path)
    const deviceWindows = output.filter((w) => w.device === capture.device)
    if (!deviceWindows.length) continue
    const profile = await load(join(directory, basename(capture.path)))
    const start = capture.clock?.beforeAt + profile.startTime / 1000 - capture.clock?.timestampMs
    const end = capture.clock?.beforeAt + profile.endTime / 1000 - capture.clock?.timestampMs
    const matches = deviceWindows.filter(
      (w) => !Number.isFinite(start) || !Number.isFinite(end) || (start < w.end && end > w.start)
    )
    for (const window of matches) {
      let summary
      try {
        summary = summarizeProfile(profile, capture, window)
      } catch (error) {
        window.profileFailures.push({ path: basename(capture.path), error: error.message })
        continue
      }
      for (const key of ['sampledMs', 'pluginStackMs']) window[key] += summary[key]
      for (const key of ['categories', 'leaves', 'leafOwners', 'nativeCallers'])
        for (const [name, time] of Object.entries(summary[key]))
          window[key][name] = (window[key][name] ?? 0) + time
      for (const [name, row] of Object.entries(summary.functions)) {
        const target = (window.functions[name] ??= { selfMs: 0, totalMs: 0, positions: [] })
        target.selfMs += row.selfMs
        target.totalMs += row.totalMs
        target.positions = [...new Set([...target.positions, ...row.positions])]
      }
      window.maxClockUncertaintyMs = Math.max(
        window.maxClockUncertaintyMs,
        summary.clockUncertaintyMs
      )
      if (summary.sampledMs) window.profiles.push(basename(capture.path))
    }
  }
  return output
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [captures, directory, windows, output] = process.argv.slice(2)
  if (!output)
    throw new Error(
      'Usage: profile-windows.mjs captures.json profile-directory windows.json output.json'
    )
  const result = await analyzeWindows(
    await readEvidenceJson(captures),
    directory,
    await readEvidenceJson(windows)
  )
  await writeFile(output, JSON.stringify(result, null, 2))
}
