export async function settleRestartDevices(devices, settle, timings, beforePrimarySettle) {
  const steps = devices.map((_, index) => `restart device ${index === 0 ? 'A' : 'B'}`)
  let settled
  if (beforePrimarySettle) {
    const peer = settle(devices[1], steps[1])
    await beforePrimarySettle()
    settled = await Promise.all([settle(devices[0], steps[0]), peer])
  } else {
    settled = await Promise.all(devices.map((device, index) => settle(device, steps[index])))
  }
  return steps.map((step, index) =>
    settled[index]
      ? (timings.findLast((row) => row.step === step && row.idle)?.endedAt ?? null)
      : null
  )
}

export function controlTiming(launchAt, events, receipt) {
  const firstAt = events.find((event) => event.event === 'start' && event.at >= launchAt)?.at
  const loadAt = receipt?.pluginLoadAt
  const idleAt = receipt?.firstIdleAt
  return {
    launchAt,
    pluginLoadAt: loadAt ?? null,
    firstRequestAt: firstAt ?? null,
    firstIdleAt: idleAt ?? null,
    launchToFirstRequestMs: firstAt == null ? null : firstAt - launchAt,
    launchToIdleMs: idleAt == null ? null : idleAt - launchAt,
    pluginLoadToFirstRequestMs: firstAt == null || loadAt == null ? null : firstAt - loadAt,
    pluginLoadToIdleMs: idleAt == null || loadAt == null ? null : idleAt - loadAt,
  }
}

export function strictWindowEvidence(startAt, endAt, device, entries, wire) {
  const inside = row => row.device === device && row.at >= startAt && row.at <= endAt
  const generations = entries.filter(row => inside(row) && row.event === 'renderer-start')
  const interruptions = [...wire, ...entries].filter(row => inside(row) &&
    (row.event === 'trigger' || /^reindex-/.test(row.event) || /hash-tracepoint-setup/.test(row.event)))
  return { startAt, endAt, device, generations: generations.map(row => row.at), interruptions,
    complete: Number.isFinite(startAt) && Number.isFinite(endAt) && endAt >= startAt &&
      generations.length === 1 && interruptions.length === 0 }
}
