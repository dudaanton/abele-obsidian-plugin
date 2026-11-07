/** Reporting only: these measurements never participate in budgets. */
export function qualificationAnalysis(report, entries, baselines = []) {
  const start = report.phases?.find((row) => row.name === 'second device pull')?.at
  const duration = report.peerInitialDownloadMs
  const seals = new Map()
  if (Number.isFinite(start) && Number.isFinite(duration))
    for (const row of entries)
      if (
        row.device === '1' &&
        row.event === 'renderer-hash' &&
        row.source === 'abele' &&
        row.stack?.includes('at async Object.seal') &&
        row.at >= start &&
        row.at <= start + duration
      )
        seals.set(row.sha, Math.min(seals.get(row.sha) ?? Infinity, row.at))
  const peerPull = []
  for (let offset = 0; Number.isFinite(duration) && offset < duration; offset += 600000) {
    const windowMs = Math.min(600000, duration - offset)
    const count = [...seals.values()].filter(
      (at) => at >= start + offset && at < start + offset + windowMs
    ).length
    peerPull.push({
      fromMinute: offset / 60000,
      toMinute: (offset + windowMs) / 60000,
      seals: count,
      filesPerSecond: count / (windowMs / 1000),
    })
  }
  return {
    peerPull,
    reindexInventory: report.reindexInventoryTimings ?? [],
    baselines: baselines.map(({ label, peerPull = [], reindexInventory = [] }) => ({
      label,
      peerPull,
      reindexInventory,
    })),
    counting:
      'SHA-deduplicated installation seals; inventory timing unavailable in older captures is not inferred',
  }
}
