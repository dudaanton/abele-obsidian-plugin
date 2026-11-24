/**
 * Module statics are new on every plugin reload. The Obsidian App object survives that reload,
 * so symbol slots there carry the in-flight teardown and, only when snapshot persistence
 * failed, its retry callback. That callback is retired once recovery commits.
 */
const SLOT = Symbol.for('abele.sync.teardown')
type Host = { [SLOT]?: Promise<void> }
const RECOVERY = Symbol.for('abele.sync.teardown-recovery')
type RecoveryHost = Host & {
  [RECOVERY]?: {
    barrier: Promise<void>
    retry(error: unknown): Promise<void>
    pending?: Promise<void>
  }
}

export function pendingTeardown(app: object): Promise<void> {
  const host = app as RecoveryHost
  const barrier = host[SLOT]
  if (barrier === undefined) return Promise.resolve()
  const recovery = host[RECOVERY]
  if (!recovery || recovery.barrier !== barrier) return barrier
  if (recovery.pending !== undefined) return recovery.pending
  const pending = barrier.catch(async (error) => {
    if (host[RECOVERY] !== recovery) throw error
    await recovery.retry(error)
    if (host[SLOT] === barrier) delete host[SLOT]
    if (host[RECOVERY] === recovery) delete host[RECOVERY]
  })
  recovery.pending = pending
  // All readers share an attempt, but a failed attempt must leave the next reload
  // free to retry rather than caching another permanently rejected promise.
  void pending.catch(() => {
    if (recovery.pending === pending) delete recovery.pending
  })
  return pending
}

export function recordTeardown(
  app: object,
  stopping: Promise<unknown>,
  retry?: (error: unknown) => Promise<void>
): void {
  const host = app as RecoveryHost
  const done = stopping.then((): void => undefined)
  host[SLOT] = done
  if (retry) host[RECOVERY] = { barrier: done, retry }
  else delete host[RECOVERY]
  void done
    .then(() => {
      if (host[SLOT] === done) delete host[SLOT]
      if (host[RECOVERY]?.barrier === done) delete host[RECOVERY]
    })
    .catch((): void => undefined) // Keep a failed barrier: a second writer must not start.
}
