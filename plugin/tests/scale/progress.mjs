import { writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

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

export async function saveCheckpoint(output, report, proxies, now = Date.now()) {
  const snapshot = JSON.stringify({
    ...report,
    checkpointAt: now,
    phaseTimings: phaseTimings(report.phases, now),
    wire: proxies.flatMap((proxy) => proxy.events),
  })
  const path = join(output, 'checkpoint.json')
  await writeFile(path + '.next', snapshot)
  await rename(path + '.next', path)
}
