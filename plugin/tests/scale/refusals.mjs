export function fileExpectations(files, limits) {
  const limit = limits?.max_file_bytes
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Server file limit unavailable')
  const oversized = files.filter((file) => file.size > limit)
  const transfer = files.filter((file) => file.size <= limit)
  if (!transfer.length) throw new Error('No eligible interruption target')
  return {
    limit,
    oversized,
    transfer,
    interruptionTarget: transfer.reduce((a, b) => (b.size > a.size ? b : a)),
  }
}

export function oversizedEvidence(files, primary, snapshots, wire, interruptions = [], restartAt) {
  const restarts = [
    ...interruptions.filter((e) =>
      [
        'kill mid-large-file',
        'quit mid-batch',
        'quit during comparison',
        'plugin disable-enable',
      ].includes(e.kind)
    ),
    ...(Number.isFinite(restartAt) ? [{ at: restartAt }] : []),
  ].sort((a, b) => a.at - b.at)
  const sizeReason = /too_large|too large|larger than|size.*limit|limit.*size/i
  const namesPath = (text, path) => {
    if (typeof text !== 'string') return false
    for (let at = text.indexOf(path); at >= 0; at = text.indexOf(path, at + 1)) {
      const before = at === 0 ? ' ' : text[at - 1]
      const after = text[at + path.length] ?? ' '
      if (/[\s"'`(:[{]/.test(before) && /[\s"'`):;,\]}]/.test(after)) return true
    }
    return false
  }
  return files.map((file) => {
    const statuses = snapshots.flatMap((s) => (s.activity ?? []).flatMap((a) => a.refused ?? []))
    const logs = snapshots.flatMap((s) => (s.activity ?? []).flatMap((a) => a.events ?? []))
    const status = statuses.filter((r) => r.path === file.path && sizeReason.test(r.reason))
    const log = logs.filter((r) => namesPath(r.text, file.path) && sizeReason.test(r.text))
    const uploadRequests = wire.filter(
      (e) =>
        e.device === '0' &&
        e.event === 'start' &&
        e.method !== 'GET' &&
        (e.route === `/v2/uploads/${file.sha}` || e.route.startsWith(`/v2/uploads/${file.sha}/`))
    )
    const intact = primary.some(
      (actual) => actual.path === file.path && actual.sha === file.sha && actual.size === file.size
    )
    const attemptEvents = wire.filter(
      (e) =>
        e.device === '0' &&
        e.event === 'start' &&
        ((e.method === 'POST' && e.route === `/v2/uploads/${file.sha}/begin`) ||
          (e.method === 'PUT' && e.route === `/v2/uploads/${file.sha}`))
    )
    const attempts = attemptEvents.length
    const generations = new Map()
    for (const event of attemptEvents) {
      const generation = restarts.filter((r) => r.at <= event.at).length
      const group = generations.get(generation) ?? {
        generation,
        attempts: 0,
        firstAt: event.at,
        lastAt: event.at,
      }
      group.attempts++
      group.lastAt = event.at
      generations.set(generation, group)
    }
    const attemptsByGeneration = [...generations.values()]
    const maxAttemptsPerGeneration = Math.max(0, ...attemptsByGeneration.map((g) => g.attempts))
    const syncedClaims = snapshots.filter((s) => s.snapshot?.rows?.some((r) => r.status === 'idle'))
    return {
      ...file,
      status,
      log,
      intact,
      attempts,
      attemptsByGeneration,
      maxAttemptsPerGeneration,
      uploadRequests,
      syncedClaims: syncedClaims.map((s) => ({ at: s.at, snapshot: s.snapshot })),
      pass:
        status.length > 0 &&
        log.length > 0 &&
        intact &&
        maxAttemptsPerGeneration <= 1 &&
        syncedClaims.length === 0 &&
        snapshots.length > 0,
    }
  })
}

export function pauseWriteMetrics(entries, device, pauseAt, endAt) {
  const relevant = entries.filter((e) => e.device === device)
  const lastStart =
    relevant.filter((e) => e.event === 'renderer-start' && e.at <= pauseAt).at(-1)?.at ?? 0
  const ready = relevant
    .filter((e) => e.event === 'write-observer-ready' && e.at >= lastStart && e.at <= pauseAt)
    .at(-1)
  if (
    !ready ||
    relevant.some((e) => e.event === 'write-observer-error' && e.at >= ready.at && e.at <= endAt)
  )
    return {}
  const generation = relevant.filter((e) => e.generation === ready.generation)
  const late = generation
    .filter((e) => e.event === 'write-start' && e.at <= endAt)
    .filter((start) => {
      const finish = generation.find((e) => e.event === 'write-finish' && e.id === start.id)
      return !finish || finish.at > pauseAt + 100
    })
  const unknown = late.some((e) => !Number.isFinite(e.bytes))
  return {
    pauseWriteObserver: ready,
    pauseWritesAfterGrace: late,
    pauseWriteOperationsAfterGrace: late.length,
    pauseWriteBytesAfterGrace: unknown ? undefined : late.reduce((sum, e) => sum + e.bytes, 0),
    pauseWriteCounting:
      'Conservative API-operation upper bound; overlapping adapter/native layers may duplicate bytes. Unknown or in-flight operations fail closed.',
  }
}
