/**
 * Module statics are new on every plugin reload. The Obsidian App object survives that reload,
 * so a symbol slot there carries only the in-flight teardown, never an engine or resolved bundle.
 */
const SLOT = Symbol.for('abele.sync.teardown')
type Host = { [SLOT]?: Promise<void> }

export function pendingTeardown(app: object): Promise<void> {
  return (app as Host)[SLOT] ?? Promise.resolve()
}

export function recordTeardown(app: object, stopping: Promise<unknown>): void {
  const host = app as Host
  const done = stopping.then((): void => undefined)
  host[SLOT] = done
  void done
    .then(() => {
      if (host[SLOT] === done) delete host[SLOT]
    })
    .catch((): void => undefined) // Keep a failed barrier: a second writer must not start.
}
