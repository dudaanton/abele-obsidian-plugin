export async function observeErrorRecovery({ first, snapshot, record, sleep, now, timeoutMs = 120000 }) {
  const startedAt = now()
  const initial = first?.activity?.find(row => row.failure || row.error)
  record({ at: startedAt, strictFail: true, snapshot: first,
    failure: initial?.failure ?? null, recovered: null })
  let last = first
  while (now() - startedAt < timeoutMs) {
    await sleep(100)
    last = await snapshot().catch(() => null)
    if (last?.rows?.length && last.rows.every(row => row.status === 'idle') &&
        last.engines?.length && last.engines.every(engine => engine.state === 'idle' && engine.lastSyncAt)) {
      const at = now()
      record({ at, strictFail: true, recovered: true, recoveryMs: at - startedAt,
        snapshot: last })
      return { recovered: true, recoveryMs: at - startedAt, snapshot: last }
    }
  }
  const at = now()
  record({ at, strictFail: true, recovered: false, recoveryMs: at - startedAt,
    snapshot: last })
  return { recovered: false, recoveryMs: at - startedAt, snapshot: last }
}
