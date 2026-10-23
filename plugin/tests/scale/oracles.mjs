import { isExcluded, selectiveDefaults, IgnoreRules, settingsCategory } from '@abele/sync-sdk/core'

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
  const watched = new Set([...activeAtPause, ...starts.map((event) => event.id)])
  const completions = relevant.filter(
    (event) => ['finish', 'close'].includes(event.event) && watched.has(event.id)
  )
  const pending = [...watched].filter((id) => activeNow.has(id)).length
  const closedWithoutTimestamp = [...watched].filter(
    (id) => !activeNow.has(id) && !completions.some((event) => event.id === id)
  ).length
  const pauseRequests = starts.map((event) => ({
    ...event,
    afterPauseMs: event.at - pausedAt,
    kind: event.contentCommit
      ? 'content commit'
      : /\/content$/.test(event.route)
        ? 'content download'
        : /\/uploads\//.test(event.route)
          ? 'upload'
          : 'metadata',
    component: event.component ?? null,
  }))
  const groups = new Map()
  for (const request of pauseRequests) {
    const endpoint = request.route
      .replace(/\/files\/[^/]+\/content$/, '/files/:id/content')
      .replace(/\/uploads\/.+$/, '/uploads/:sha/:upload/:chunk')
    const key = `${request.method} ${endpoint} ${request.kind}`
    const group = groups.get(key) ?? {
      method: request.method,
      route: endpoint,
      kind: request.kind,
      count: 0,
      firstAfterPauseMs: request.afterPauseMs,
      lastAfterPauseMs: request.afterPauseMs,
    }
    group.count++
    group.lastAfterPauseMs = request.afterPauseMs
    groups.set(key, group)
  }
  return {
    pauseAt: pausedAt,
    pauseActiveAtPause: [...activeAtPause],
    pauseClosedWithoutTimestamp: closedWithoutTimestamp,
    pauseStopUpperBoundMs: pending ? null : observedAt - pausedAt,
    pauseRequests,
    pauseByEndpoint: [...groups.values()],
    pauseBySecond: Array.from(
      { length: Math.ceil((observedAt - pausedAt) / 1000) },
      (_, second) => ({
        second,
        count: starts.filter((event) => Math.floor((event.at - pausedAt) / 1000) === second).length,
      })
    ),
    pauseNewRequests: starts.length,
    pauseLastRequestMs: starts.length ? Math.max(...starts.map((e) => e.at - pausedAt)) : 0,
    pauseInFlight: pending,
    pauseObservedMs: observedAt - pausedAt,
    pauseLatencyMs: closedWithoutTimestamp
      ? undefined
      : Math.max(
          0,
          ...[...starts, ...completions].map((event) => event.at - pausedAt),
          pending ? observedAt - pausedAt : 0
        ),
  }
}

export function attributePauseRequests(requests, traces) {
  const used = new Set()
  for (const request of requests) {
    const caller = traces
      .filter(
        (e) =>
          !used.has(e) &&
          e.device === request.device &&
          e.method === request.method &&
          e.route === request.route &&
          e.at <= request.at &&
          request.at - e.at < 1000
      )
      .sort((a, b) => b.at - a.at)[0]
    if (!caller) continue
    used.add(caller)
    request.component = 'transport call stack'
    request.callerAt = caller.at
    request.callerStack = caller.stack
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
    timing(
      'restart first request',
      m.startupClock === 'plugin-load' ? m.restartPluginRequestMs : m.restartRequestMs,
      5000
    ),
    timing(
      'restart idle',
      m.startupClock === 'plugin-load' ? m.restartPluginIdleMs : m.restartIdleMs,
      60000
    ),
    timing('resume upload', m.resumeUploadMs, 30000),
    timing('pause latency', m.pauseLatencyMs, 2000),
    check(
      'pause request grace',
      m.pauseLastRequestMs,
      '<= 100 ms',
      Number.isFinite(m.pauseLastRequestMs) && m.pauseLastRequestMs <= 100
    ),
    check(
      'pause vault writes',
      m.pauseWriteBytesAfterGrace,
      '0 bytes after +100 ms',
      m.pauseWriteBytesAfterGrace === 0 && m.pauseWriteOperationsAfterGrace === 0
    ),
    ...(m.oversizedFiles?.length
      ? [
          check(
            'oversized refusals',
            m.oversizedEvidence?.filter((row) => !row.pass).length,
            0,
            m.oversizedEvidence?.length === m.oversizedFiles.length &&
              m.oversizedEvidence.every((row) => row.pass)
          ),
        ]
      : []),
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
  const details = (title, rows) =>
    `\n## ${title}\n\n` +
    (rows?.length
      ? rows.map((row) => `- ${JSON.stringify(row).replaceAll('|', '\\|')}`).join('\n')
      : 'Unobserved / none recorded') +
    '\n'
  return (
    `# Sync scale run\n\nBuild: ${report.build}\nSeed: ${report.seed}\nShape: ${report.files} files / ${report.bytes} bytes\n\n` +
    '| Budget | Result | Observed | Required |\n|---|---|---|---|\n' +
    report.budgets
      .map((row) => `| ${row.name} | ${row.status} | ${JSON.stringify(row.value)} | ${row.limit} |`)
      .join('\n') +
    `\n\nThroughput: ${report.filesPerSecond ?? 'unobserved'} files/s; ${report.mibPerSecond ?? 'unobserved'} MiB/s.\n` +
    (report.failure ? `\nStopped in ${report.phase}: ${report.failure}\n` : '') +
    details('Phase timings (ongoing means incomplete)', report.phaseTimings) +
    details('Interruption recovery observations (null means unobserved)', report.recoveryTimings) +
    details('Notices (text, time, phase)', report.noticeDetails) +
    details('Excluded by settings', report.excludedBySettings) +
    details('Visible case refusals on primary', report.caseRefusals) +
    details('Oversized refusal evidence', report.oversizedEvidence) +
    details(
      'Raw strict-zero pause count (measurement only)',
      report.pauseNewRequests == null ? [] : [{ count: report.pauseNewRequests }]
    ) +
    details('Vault writes after pause grace', report.pauseWritesAfterGrace) +
    details(
      'Primary visible activity snapshots (full rows in JSON)',
      report.primaryActivity?.map((snapshot) => ({
        phase: snapshot.phase,
        at: snapshot.at,
        connections: snapshot.activity?.map((row) => ({
          id: row.id,
          refused: row.refused,
          events: row.events.length,
        })),
      }))
    ) +
    details('Pause requests by endpoint', report.pauseByEndpoint) +
    details('Pause requests by second after action', report.pauseBySecond) +
    details('Pause request timeline (component null means unavailable)', report.pauseRequests) +
    details(
      'Startup timing (observer load is not product plugin load; null means unavailable)',
      report.startupTiming
    ) +
    details('Diagnostic findings', report.findings) +
    (report.comparison
      ? '\n## Master smoke versus candidate\n\nUnknown baseline product-load timing stays unknown; launch and product clocks are shown separately.\n\n| Metric | Master | Candidate |\n|---|---|---|\n' +
        report.comparison
          .map(
            (row) =>
              `| ${row.metric} | ${row.master ?? 'unobserved'} | ${row.candidate ?? 'unobserved'} |`
          )
          .join('\n') +
        '\n'
      : '')
  )
}

export function compareReports(master, candidate) {
  const row = (metric, key) => ({
    metric,
    master: master[key] ?? null,
    candidate: candidate[key] ?? null,
  })
  const format = (value) => (value ? `${JSON.stringify(value.value)} (${value.status})` : null)
  return [
    row('Build', 'build'),
    {
      metric: 'Startup budget clock',
      master: master.startupClock ?? 'app launch',
      candidate: candidate.startupClock ?? 'app launch',
    },
    row('First request from app launch (ms)', 'restartRequestMs'),
    row('First request from plugin load (ms)', 'restartPluginRequestMs'),
    row('Idle from app launch (ms)', 'restartIdleMs'),
    row('Idle from plugin load (ms)', 'restartPluginIdleMs'),
    ...[
      ...new Set([...(master.budgets ?? []), ...(candidate.budgets ?? [])].map((one) => one.name)),
    ].map((metric) => ({
      metric,
      master: format(master.budgets?.find((one) => one.name === metric)),
      candidate: format(candidate.budgets?.find((one) => one.name === metric)),
    })),
    row('Files per second including interruptions', 'filesPerSecond'),
    row('MiB per second including interruptions', 'mibPerSecond'),
    row('Maximum renderer task, all activity (ms)', 'maxRendererTaskMs'),
    row('Gate', 'status'),
  ]
}
export function expectedSet(files, policy) {
  const defaults = selectiveDefaults()
  const selective = {
    ...defaults,
    ...policy.selective,
    settings: { ...defaults.settings, ...policy.selective?.settings },
  }
  const rules = policy.ignoreText ? IgnoreRules.parse(policy.ignoreText) : null
  const excluded = [],
    synced = []
  for (const file of files) {
    const hidden =
      file.path.split('/').some((part) => part.startsWith('.')) &&
      !(
        settingsCategory(`${policy.configDir}/app.json`) !== null &&
        file.path.startsWith(policy.configDir + '/')
      )
    if (
      hidden ||
      rules?.ignores(file.path) ||
      isExcluded(file.path, file.size, selective, policy.scriptsFolder ?? 'Scripts')
    )
      excluded.push({ ...file, reason: 'excluded by settings' })
    else synced.push(file)
  }
  return { synced, excluded }
}

export function comparePeer(set, actual, refusals) {
  return compareInventory(set.synced, actual).filter((row) => {
    if (row.kind !== 'missing') return true
    const twin = set.synced.some(
      (file) =>
        file.path !== row.path &&
        file.path.normalize('NFC').toLowerCase() === row.path.normalize('NFC').toLowerCase()
    )
    return (
      !twin ||
      !refusals.some(
        (refusal) => refusal.path === row.path && /case.*collision/i.test(refusal.reason)
      )
    )
  })
}

export function noticeDetails(entries, phases = []) {
  return entries
    .filter((entry) => entry.event === 'notice')
    .map((entry) => ({
      ...entry,
      text: entry.text ?? null,
      phase:
        entry.phase ?? phases.filter((phase) => phase.at <= entry.at).at(-1)?.name ?? 'unobserved',
    }))
}

export function startupTiming(launchAt, firstAt, entries, idleAt) {
  const load = entries.find(
    (e) => e.event === 'renderer-start' && e.at >= launchAt && e.at <= firstAt
  )
  const sync = entries.find(
    (e) => e.event === 'sync-start' && e.at >= (load?.at ?? launchAt) && e.at <= firstAt
  )
  const pluginLoad = entries.find(
    (e) => e.event === 'plugin-load' && e.at >= launchAt && e.at <= (sync?.at ?? firstAt)
  )
  return {
    launchAt,
    firstRequestAt: firstAt ?? null,
    observerLoadAt: load?.at ?? null,
    pluginLoadAt: pluginLoad?.at ?? null,
    syncStartAt: sync?.at ?? null,
    launchToFirstRequestMs: firstAt == null ? null : firstAt - launchAt,
    launchToObserverLoadMs: load ? load.at - launchAt : null,
    observerLoadToFirstRequestMs: load && firstAt != null ? firstAt - load.at : null,
    pluginLoadToSyncStartMs: pluginLoad && sync ? sync.at - pluginLoad.at : null,
    pluginLoadToFirstRequestMs: pluginLoad && firstAt != null ? firstAt - pluginLoad.at : null,
    pluginLoadToIdleMs: pluginLoad && idleAt != null ? idleAt - pluginLoad.at : null,
    launchToIdleMs: idleAt == null ? null : idleAt - launchAt,
    syncStartToFirstRequestMs: sync && firstAt != null ? firstAt - sync.at : null,
  }
}
