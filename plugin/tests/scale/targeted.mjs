/** A content-request pacer outside the renderer; metadata and commits are never delayed. */
export function contentRequestDelay(method, path, now, next, spacing) {
  if (method !== 'GET' || !/^\/v2\/files\/[^/]+\/content$/.test(path)) return { delay: 0, next }
  const begin = Math.max(now, next)
  return { delay: begin - now, next: begin + spacing }
}

export async function visibilityExperiment({
  visibility,
  sample,
  sleep,
  now = Date.now,
  durationMs = 180000,
}) {
  const segments = []
  try {
    for (const visible of [true, false, true]) {
      const state = await visibility(visible)
      const segment = { visible, state, beginAt: now(), samples: [] }
      segments.push(segment)
      while (now() - segment.beginAt < durationMs) {
        await sleep(Math.min(30000, durationMs - (now() - segment.beginAt)))
        segment.samples.push(await sample())
      }
      segment.endAt = now()
    }
    return segments
  } finally {
    await visibility(true)
  }
}

export function targetedBudgets(report) {
  const t = report.targeted ?? {}
  const errors = report.failures ?? []
  const phaseErrors = {
    A: /first upload|second device pull/,
    B: /restart device|synced restart/,
    C: /offline|stopped-app changes/,
    D: /crash/,
    E: /verification/,
  }
  const conditions = {
    A: t.A?.complete,
    B:
      t.B?.complete &&
      report.restartReadEvidence?.length === 2 &&
      report.restartReadEvidence.every((row) => row.complete && row.syncBytes === 0),
    C: t.C?.complete && t.C.syncDuringIndexWait,
    D: t.D?.complete && t.D.tokenPresent && t.D.commitCut,
    E:
      t.E?.complete &&
      report.installedFileReadbackBytes === 0 &&
      (report.unknownInstalledReadbackCount ?? 0) === 0 &&
      report.mismatches?.length === 0,
  }
  return Object.entries(conditions).map(([name, passed]) => ({
    name,
    status: passed && !errors.some((row) => phaseErrors[name].test(row.step)) ? 'PASS' : 'FAIL',
    reason: 'Completion and strict phase invariants; any observed error is a failure',
  }))
}

/** Installation receipts establish a digest boundary; host indexing stays separately visible. */
export function postSealEvidence(entries, device, { untilAt = Infinity } = {}) {
  const seals = new Map()
  const firstSeals = new Map()
  const plugin = [],
    host = [],
    unknown = []
  const laterPlugin = [],
    laterHost = [],
    laterUnknown = []
  for (const row of entries) {
    if (row.device !== device || row.event !== 'renderer-hash') continue
    if (row.source === 'abele' && String(row.stack ?? '').includes('at async Object.seal')) {
      seals.set(row.sha, row.at)
      if (!firstSeals.has(row.sha)) firstSeals.set(row.sha, row.at)
    } else if (seals.has(row.sha) && row.at > seals.get(row.sha)) {
      if (row.source === 'abele') (row.at <= untilAt ? plugin : laterPlugin).push(row)
      else if (row.source === 'host') (row.at <= untilAt ? host : laterHost).push(row)
      else (row.at <= untilAt ? unknown : laterUnknown).push(row)
    }
  }
  return {
    plugin,
    host,
    unknown,
    laterPlugin,
    laterHost,
    laterUnknown,
    seals: [...firstSeals].map(([sha, at]) => ({ sha, at })),
  }
}
