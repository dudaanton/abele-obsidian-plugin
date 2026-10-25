import { copyFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { writeEvidenceJson } from './evidence.mjs'

export function requireServerCapacity(plan, limits) {
  const requiredFileBytes = plan.reduce((largest, file) => Math.max(largest, file.size), 0)
  const serverFileBytes = limits?.max_file_bytes
  if (!Number.isSafeInteger(serverFileBytes) || serverFileBytes <= 0)
    throw new Error('Server file limit unavailable')
  if (serverFileBytes < requiredFileBytes)
    throw new Error(`Server file limit ${serverFileBytes} is below required ${requiredFileBytes}`)
  return { requiredFileBytes, serverFileBytes, quotaBytes: limits.quota_bytes }
}

export function activeRequestIds(events, at) {
  const active = new Set()
  for (const event of events) {
    if (event.at > at) continue
    if (event.event === 'start') active.add(event.id)
    if (event.event === 'finish' || event.event === 'close') active.delete(event.id)
  }
  return active
}

export function recoveryTimings(interruptions, wire, settles) {
  return interruptions.map((interruption, i) => {
    const end = interruptions[i + 1]?.at ?? Infinity
    const device = interruption.kind === 'pause mid-pull' ? '1' : '0'
    const events = wire.filter(
      (event) => event.device === device && event.at >= interruption.at && event.at < end
    )
    const starts = events.filter((event) => event.event === 'start')
    const ids = new Set(starts.map((event) => event.id))
    const successful = events.find(
      (event) =>
        event.event === 'finish' && event.status >= 200 && event.status < 300 && ids.has(event.id)
    )
    const idle = settles.find(
      (step) =>
        step.device === device && step.idle && step.endedAt >= interruption.at && step.endedAt < end
    )
    return {
      ...interruption,
      device,
      firstRequestMs: starts.length ? starts[0].at - interruption.at : null,
      firstSuccessfulResponseMs: successful ? successful.at - interruption.at : null,
      idleMs: idle ? idle.endedAt - interruption.at : null,
    }
  })
}

export function requireTime(deadline, now = Date.now()) {
  if (now >= deadline) throw new Error('Run deadline reached')
}

export function phaseTimings(phases, now = Date.now()) {
  return phases.map((phase, i) => ({
    ...phase,
    durationMs: (phases[i + 1]?.at ?? now) - phase.at,
    ongoing: i === phases.length - 1 && phase.name !== 'complete',
  }))
}

export async function saveCheckpoint(output, report, proxies, now = Date.now(), boundary = false) {
  await writeEvidenceJson(join(output, 'phase-status.json'), {
    phase: report.phase,
    checkpointAt: now,
    phaseTimings: phaseTimings(report.phases, now),
    harnessFailures: report.harnessFailures,
    remainingPhaseEvidence: report.remainingPhaseEvidence,
    failure: report.failure,
    metrics: Object.fromEntries(
      [
        'initialUploadMs',
        'peerInitialDownloadMs',
        'resumeUploadMs',
        'uploadedFiles',
        'uploadedBytes',
        'peakAppRssBytes',
      ].map((key) => [key, report[key]])
    ),
    interruptionCount: report.interruptions?.length ?? 0,
    wireEvents: proxies.reduce((n, proxy) => n + proxy.events.length, 0),
  })
  const snapshot = {
    ...report,
    checkpointAt: now,
    phaseTimings: phaseTimings(report.phases, now),
    wire: proxies.flatMap((proxy) => proxy.events),
  }
  const path = join(output, 'checkpoint.json')
  await writeEvidenceJson(path, snapshot)
  if (boundary) {
    const folder = join(output, 'phases')
    await mkdir(folder, { recursive: true })
    const phasePath = join(
      folder,
      `${now}-${report.phases.length}-${report.interruptions?.length ?? 0}.json`
    )
    await copyFile(path, phasePath + '.next')
    await rename(phasePath + '.next', phasePath)
  }
}

export async function saveFailureCheckpoint(output, report, proxies, stage, at = Date.now()) {
  const phases = [
    'preflight',
    'generate and install',
    'first upload',
    'resume upload',
    'comparison interruption',
    'network and plugin interruption',
    'second device pull',
    'edits and settle',
    'synced restart',
    'byte verification',
    'complete',
  ]
  report.harnessFailures ??= []
  report.harnessFailures.push({ stage, phase: report.phase, at })
  report.remainingPhaseEvidence = phases
    .slice(phases.indexOf(report.phase) + 1)
    .map((phase) => ({ phase, status: 'not run' }))
  await saveCheckpoint(output, report, proxies, at, true)
}
export function requireHealthySnapshot(snapshot) {
  if (snapshot?.rows?.some((row) => row.status === 'error'))
    throw new Error('Fatal sync state; see retained snapshot')
}

export function uploadRecoveryMetrics(
  events,
  startedAt,
  { untilAt = Infinity, device = '0' } = {}
) {
  const observed = Number.isFinite(startedAt)
  const result = {
    observed,
    firstRequestMs: null,
    firstUploadMs: null,
    firstPayloadPutMs: null,
    headRequestsSeen: observed ? 0 : null,
    headRequestsBeforeUpload: null,
    headStatusesBeforeUpload: null,
  }
  if (!observed) return result
  const heads = [],
    finishes = new Map()
  const first = (field, at) => {
    result[field] = Math.min(result[field] ?? Infinity, at - startedAt)
  }
  for (const event of events) {
    if (event.device !== device || event.at < startedAt || event.at >= untilAt) continue
    if (event.event === 'finish') finishes.set(event.id, event.status)
    if (event.event !== 'start') continue
    first('firstRequestMs', event.at)
    if (event.method === 'HEAD' && /^\/v2\/uploads\//.test(event.route)) {
      heads.push(event)
      result.headRequestsSeen++
    }
    const upload = /^\/v2\/uploads\//.test(event.route)
    if (['PUT', 'POST'].includes(event.method) && (upload || event.contentCommit))
      first('firstUploadMs', event.at)
    if (event.method === 'PUT' && upload && event.sent > 0) first('firstPayloadPutMs', event.at)
  }
  if (result.firstUploadMs !== null) {
    const before = heads.filter((event) => event.at - startedAt < result.firstUploadMs)
    result.headRequestsBeforeUpload = before.length
    const statuses = { present: 0, absent: 0, other: 0, incomplete: 0 }
    for (const event of before) {
      const status = finishes.get(event.id)
      statuses[
        status === undefined
          ? 'incomplete'
          : status === 200
            ? 'present'
            : status === 404
              ? 'absent'
              : 'other'
      ]++
    }
    result.headStatusesBeforeUpload = statuses
  }
  return result
}
