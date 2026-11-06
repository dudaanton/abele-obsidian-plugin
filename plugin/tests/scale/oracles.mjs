import { jsonPieces } from './evidence.mjs'
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

export function longTaskVerdict(task) {
  const owner = task.owner ?? 'unattributed'
  // Ownership identifies whether our code participates; the budget is for the
  // whole task, including bundle reads/compilation before evaluation marks.
  const durationMs = task.durationMs
  const limit = owner === 'plugin load' ? 800 : owner === 'teardown' ? null : 50
  const pass = owner === 'teardown' || (owner === 'plugin load' && durationMs <= limit) ||
    task.profileWindowComplete === true &&
    (owner === 'host-only' || owner === 'harness-triggered' ||
      (owner === 'ours during sync' && durationMs <= limit) ||
      (owner === 'plugin load' && durationMs <= limit))
  return { owner, durationMs, limit, gated: owner !== 'teardown', status: pass ? 'PASS' : 'FAIL' }
}

export function longTaskBudget(tasks) {
  const verdicts = (tasks ?? [])
    .filter(row => !Number.isFinite(row.durationMs) || row.durationMs > 50)
    .map(longTaskVerdict)
  return { verdicts, failed: verdicts.filter(row => row.status === 'FAIL').length }
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
    ...(m.strictRestartWindows ? [check('clean strict restart windows',
      m.strictRestartWindows.filter(row => !row.complete).length, 0,
      m.strictRestartWindows.length === 2 && m.strictRestartWindows.every(row => row.complete))] : []),
    ...(m.profileCoverageRequired || m.longTaskAttribution?.length ? [check('long task ownership and budgets',
      longTaskBudget(m.longTaskAttribution).failed,
      'ours <= 50 ms during sync; plugin load <= 800 ms; all tasks attributed',
      Array.isArray(m.longTaskAttribution) && longTaskBudget(m.longTaskAttribution).failed === 0)] : []),
    ...(m.postSealProofRequired ? [check('installed file read-back', m.installedFileReadbackBytes,
      '0 unexplained bytes; explicit boundary-proven recovery only',
      m.postSealObservationComplete === true && m.installedFileReadbackBytes === 0 &&
      m.unknownInstalledReadbackCount === 0)] : []),
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
    ...(m.restartContentReadRequired
      ? [
          check(
            'restart content reads',
            m.restartContentReadBytes,
            '0 sync content bytes',
            m.restartContentReadBytes === 0
          ),
        ]
      : []),
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
    ...(m.checkpointFailure !== undefined
      ? [check('phase evidence', m.checkpointFailure, false, m.checkpointFailure === false)]
      : []),
    check('notices', m.notices, 0, m.notices === 0),
    ...(m.noticeCounts
      ? [check('notice attribution', m.noticeCounts.unknown, 0, m.noticeCounts.unknown === 0)]
      : []),
    check(
      'byte equality',
      m.mismatches?.length,
      0,
      m.verificationComplete === true && m.verifiedFiles > 0 && m.mismatches?.length === 0
    ),
    ...(m.declaredInterruptions?.some((one) => one.kind === 'reindex')
      ? [
          check(
            'reindex invariants',
            m.reindexes?.length,
            'all declared rebuilds proven',
            m.declaredInterruptions
              .filter((one) => one.kind === 'reindex')
              .every((required) =>
                m.reindexes?.some((one) => one.id === required.id && one.status === 'PASS')
              )
          ),
        ]
      : []),
    check(
      'interruptions',
      m.interruptions?.filter((one) => one.triggered).length,
      m.declaredInterruptions ? 'every declared occurrence' : '>= 6 distinct',
      m.declaredInterruptions
        ? m.declaredInterruptions.length > 0 &&
            m.declaredInterruptions.every((required) =>
              m.interruptions?.some(
                (one) =>
                  one.triggered &&
                  one.kind === required.kind &&
                  (!required.id || one.id === required.id) &&
                  (!required.device || one.device === required.device)
              )
            )
        : new Set(m.interruptions?.filter((one) => one.triggered).map((one) => one.kind)).size >= 6
    ),
  ]
}

export function markdown(report) {
  return [...markdownChunks(report)].join('')
}

export function* markdownChunks(report) {
  function* details(title, rows) {
    yield `\n## ${title}\n\n`
    if (!rows?.length) yield 'Unobserved / none recorded'
    else
      for (const row of rows) {
        yield '- '
        for (const piece of jsonPieces(row)) yield piece.replaceAll('|', '\\|')
        yield '\n'
      }
    yield '\n'
  }
  yield `# Sync scale run\n\nBuild: ${report.build}\nSeed: ${report.seed}\nShape: ${report.files} files / ${report.bytes} bytes\n\n`
  yield '| Budget | Result | Observed | Required |\n|---|---|---|---|\n'
  for (const row of report.budgets)
    yield `| ${row.name} | ${row.status} | ${JSON.stringify(row.value)} | ${row.limit} |\n`
  yield `\nThroughput: ${report.filesPerSecond ?? 'unobserved'} files/s; ${report.mibPerSecond ?? 'unobserved'} MiB/s.\n`
  if (report.failure) yield `\nStopped in ${report.phase}: ${report.failure}\n`
  yield* details('Phase timings (ongoing means incomplete)', report.phaseTimings)
  yield* details(
    'Interruption recovery observations (null means unobserved)',
    report.recoveryTimings
  )
  yield* details(
    'Vault cache rebuilds (missing causal evidence fails)',
    report.reindexes?.map((row) => ({
      id: row.id,
      device: row.device,
      phase: row.phase,
      at: row.at,
      durationMs: row.durationMs,
      requests: row.requests?.length,
      writes: row.writes?.length,
      deletions: row.deletions?.length,
      serverDeletions: row.serverDeletions?.length,
      recoveryDeletions: row.recoveryDeletions,
      extraUploads: row.extraUploads,
      extraDownloads: row.extraDownloads,
      extraRendererHashes: row.extraRendererHashes,
      postReindexPayloadDigests: row.postReindexPayloadDigests,
      otherPostReindexHashes: row.otherPostReindexHashes,
      notices: row.notices,
      longTasks: row.longTasks?.map(({ startedAt, durationMs, source, samplesBySource }) => ({
        startedAt,
        durationMs,
        source,
        samplesBySource,
      })),
      javascriptHashCoverage: row.javascriptHashCoverage,
      settledAt: row.settledAt,
      status: row.status,
    }))
  )
  yield* details('Notices (text, time, phase, creation origin)', report.noticeDetails)
  yield* details(
    'Notice counts by source (only Abele notices enter the notice gate)',
    report.noticeCounts ? [report.noticeCounts] : []
  )
  yield* details(
    'Server provenance and advertised limits',
    report.serverReceipt ? [report.serverReceipt] : []
  )
  yield* details('Synced restart content read evidence', report.restartReadEvidence)
  yield* details(
    'Synced restart classification (cache, hits, misses by caller/reason, read bytes and stacks)',
    report.restartClassification
  )
  yield* details(
    'Harness hash tracepoint setup intervals (included in raw startup clocks)',
    report.hashTracepointSetup
  )
  yield* details(
    'Long tasks with tracepoint setup intervals subtracted (accounting view only)',
    report.tracepointAdjustedLongTasks
  )
  yield* details('Renderer long-task sampled CPU attribution', report.longTaskAttribution)
  yield* details('Sampled peak app RSS', [
    {
      bytes: report.peakAppRssBytes ?? null,
      samples: report.memorySamples ?? 0,
      coverage: report.memorySampling,
    },
  ])
  yield* details('Excluded by settings', report.excludedBySettings)
  yield* details('Visible case refusals on primary', report.caseRefusals)
  yield* details('Oversized refusal evidence', report.oversizedEvidence)
  yield* details(
    'Raw strict-zero pause count (measurement only)',
    report.pauseNewRequests == null ? [] : [{ count: report.pauseNewRequests }]
  )
  yield* details(
    'Sync or unattributed vault writes after pause grace',
    report.pauseWritesAfterGrace
  )
  yield* details('Proven host persistence after pause grace', report.pauseHostWritesAfterGrace)
  yield* details(
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
  )
  yield* details('Pause requests by endpoint', report.pauseByEndpoint)
  yield* details('Pause requests by second after action', report.pauseBySecond)
  yield* details('Pause request timeline (component null means unavailable)', report.pauseRequests)
  yield* details(
    'Startup timing (observer load is not product plugin load; null means unavailable)',
    report.startupTiming
  )
  yield* details('Diagnostic findings', report.findings)
  if (report.comparison) {
    yield '\n## Master smoke versus candidate\n\nUnknown baseline product-load timing stays unknown; launch and product clocks are shown separately.\n\n| Metric | Master | Candidate |\n|---|---|---|\n'
    for (const row of report.comparison)
      yield `| ${row.metric} | ${row.master ?? 'unobserved'} | ${row.candidate ?? 'unobserved'} |\n`
  }
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
