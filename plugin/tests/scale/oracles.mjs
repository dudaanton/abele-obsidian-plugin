export function compareInventory(expected, actual) {
  const wanted = new Map(expected.map((file) => [file.path, file]))
  const found = new Map(actual.map((file) => [file.path, file]))
  const errors = []
  for (const [path, file] of wanted) {
    const other = found.get(path)
    if (!other) errors.push({ path, kind: 'missing' })
    else if (other.sha !== file.sha || other.size !== file.size) errors.push({ path, kind: 'sha' })
  }
  for (const path of found.keys()) if (!wanted.has(path)) errors.push({ path, kind: 'extra' })
  return errors
}

export function pauseMetrics(events, pausedAt, activeAtPause, activeNow, observedAt) {
  const relevant = events.filter((event) => event.at >= pausedAt && event.at <= observedAt)
  const starts = relevant.filter((event) => event.event === 'start')
  const completions = relevant.filter(
    (event) => event.event === 'finish' && activeAtPause.has(event.id)
  )
  const pending = [...activeAtPause].filter((id) => activeNow.has(id)).length
  return {
    pauseNewRequests: starts.length,
    pauseInFlight: pending,
    pauseObservedMs: observedAt - pausedAt,
    pauseLatencyMs: Math.max(
      0,
      ...[...starts, ...completions].map((event) => event.at - pausedAt),
      pending ? observedAt - pausedAt : 0
    ),
  }
}

export function budgets(m) {
  const check = (name, value, limit, pass) => ({
    name,
    value: value ?? null,
    limit,
    status: pass ? 'PASS' : 'FAIL',
  })
  const timing = (name, value, limit) =>
    check(name, value, `< ${limit} ms`, Number.isFinite(value) && value < limit)
  return [
    timing('restart first request', m.restartRequestMs, 5000),
    timing('restart idle', m.restartIdleMs, 60000),
    timing('resume upload', m.resumeUploadMs, 30000),
    timing('pause latency', m.pauseLatencyMs, 2000),
    check('pause new requests', m.pauseNewRequests, 0, m.pauseNewRequests === 0),
    check('own content downloads', m.ownDownloads, 0, m.ownDownloads === 0),
    check('unresolved content downloads', m.unresolvedDownloads, 0, m.unresolvedDownloads === 0),
    check('notices', m.notices, 0, m.notices === 0),
    check(
      'byte equality',
      m.mismatches?.length,
      0,
      m.verificationComplete === true && m.verifiedFiles > 0 && m.mismatches?.length === 0
    ),
    check(
      'interruptions',
      m.interruptions?.filter((one) => one.triggered).length,
      '>= 6 distinct',
      new Set(m.interruptions?.filter((one) => one.triggered).map((one) => one.kind)).size >= 6
    ),
  ]
}

export function markdown(report) {
  return (
    `# Sync scale run\n\nBuild: ${report.build}\nSeed: ${report.seed}\nShape: ${report.files} files / ${report.bytes} bytes\n\n` +
    '| Budget | Result | Observed | Required |\n|---|---|---|---|\n' +
    report.budgets
      .map((row) => `| ${row.name} | ${row.status} | ${JSON.stringify(row.value)} | ${row.limit} |`)
      .join('\n') +
    `\n\nThroughput: ${report.filesPerSecond ?? 'unobserved'} files/s; ${report.mibPerSecond ?? 'unobserved'} MiB/s.\n` +
    (report.failure ? `\nStopped in ${report.phase}: ${report.failure}\n` : '')
  )
}
