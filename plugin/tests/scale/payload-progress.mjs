/** Credit completed plugin payload writes, never network receipts or metadata persistence. */
export function visibilityPayloadProgress(entries, segments, { device, scope }) {
  const relevant = entries.filter((row) => row.device === device)
  const key = (row) => `${row.generation}:${row.id}`
  const finishes = new Map(
    relevant.filter((row) => row.event === 'write-finish').map((row) => [key(row), row])
  )
  const candidates = new Map()
  for (const row of relevant) {
    if (
      row.event !== 'write-start' ||
      row.source !== 'abele' ||
      !/^(?:native|handle)\.(?:write|writev|writeFile|appendFile)$/.test(row.method ?? '') ||
      !(
        row.path?.startsWith(scope + '/') ||
        /^\.abele-sync\/connections\/[^/]+\/writes\//.test(row.path ?? '')
      )
    )
      continue
    const finish = finishes.get(key(row))
    const bytes = finish?.bytesWritten ?? row.bytes
    if (!finish || finish.failed || !Number.isFinite(bytes) || bytes <= 0) continue
    candidates.set(key(row), { ...row, beginAt: row.at, at: finish.at, bytes })
  }
  const paths = new Map()
  for (const row of candidates.values()) {
    if (!paths.has(row.path)) paths.set(row.path, [])
    paths.get(row.path).push(row)
  }
  const layer = (method) =>
    method.startsWith('native.') ? 0 : /\.(write|writev)$/.test(method) ? 2 : 1
  const writes = [...candidates.values()].filter(
    (parent) =>
      !paths
        .get(parent.path)
        .some(
          (child) =>
            layer(child.method) > layer(parent.method) &&
            child.beginAt >= parent.beginAt &&
            child.at <= parent.at
        )
  )
  const measured = segments.map((segment) => {
    const ready = relevant
      .filter((row) => row.event === 'write-observer-ready' && row.at <= segment.beginAt)
      .at(-1)
    const coverage =
      !!ready &&
      !relevant.some(
        (row) =>
          row.event === 'write-observer-error' && row.at >= ready.at && row.at < segment.endAt
      )
    const completed = writes.filter((row) => row.at >= segment.beginAt && row.at < segment.endAt)
    return {
      ...segment,
      installedPayloadBytes: completed.reduce((sum, row) => sum + row.bytes, 0),
      payloadWriteOperations: completed.length,
      payloadWriteCoverage: coverage,
    }
  })
  return {
    segments: measured,
    complete:
      measured.length === 3 &&
      measured.every(
        (segment) =>
          segment.payloadWriteCoverage &&
          segment.installedPayloadBytes > 0 &&
          segment.quitOrUnload?.length === 0
      ),
  }
}

/** Per immutable payload: include the full first-request-to-seal interval, not just HTTP time. */
export function largeFileThroughput(entries, wire, versions, { device, beginAt, endAt }) {
  const seals = new Map()
  for (const row of entries) {
    if (
      row.device === device &&
      row.event === 'renderer-hash' &&
      row.source === 'abele' &&
      row.bytes > 64 * 1024 ** 2 &&
      row.at >= beginAt &&
      row.at <= endAt &&
      row.stack?.includes('at async Object.seal') &&
      !seals.has(row.sha)
    )
      seals.set(row.sha, row)
  }
  const relevant = wire.filter((row) => row.device === device)
  const finishes = new Map(
    relevant.filter((row) => row.event === 'finish').map((row) => [row.id, row])
  )
  return [...seals.values()].map((seal) => {
    const requests = relevant
      .filter(
        (row) =>
          row.event === 'start' &&
          row.method === 'GET' &&
          /\/content$/.test(row.route ?? '') &&
          versions.get(row.version) === seal.sha &&
          row.at >= beginAt &&
          row.at <= seal.at
      )
      .sort((a, b) => a.at - b.at)
    const firstAt = requests[0]?.at
    const durationMs = firstAt == null ? null : seal.at - firstAt
    const sizes = new Map()
    let active = [],
      maxConcurrent = 0
    const ranges = requests.map((row) => {
      active = active.filter((at) => at > row.at)
      const finish = finishes.get(row.id)
      active.push(finish?.at ?? seal.at)
      maxConcurrent = Math.max(maxConcurrent, active.length)
      if (finish?.status === 206) sizes.set(finish.bytes, (sizes.get(finish.bytes) ?? 0) + 1)
      return {
        id: row.id,
        beginAt: row.at,
        endAt: finish?.at ?? null,
        range: row.range ?? null,
        bytes: finish?.bytes ?? null,
        status: finish?.status ?? null,
      }
    })
    return {
      sha: seal.sha,
      size: seal.bytes,
      firstRequestAt: firstAt ?? null,
      sealAt: seal.at,
      durationMs,
      mibPerSecond: durationMs > 0 ? seal.bytes / 1024 ** 2 / (durationMs / 1000) : null,
      pattern: requests.length ? (maxConcurrent > 1 ? 'parallel' : 'sequential') : 'unobserved',
      maxConcurrent,
      chunkSizes: [...sizes].map(([bytes, count]) => ({ bytes, count })),
      ranges,
    }
  })
}
