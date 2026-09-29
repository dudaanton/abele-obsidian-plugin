import { compareVersions, type Range } from './model'

export interface VersionStore {
  read(): unknown
  write(value: { schema: 1; lastRunVersion: string }): void
}

/** The last version run, not a high-water mark or proof that the person read the notes. */
export function recordRun(store: VersionStore, running: string): Range | null {
  if (compareVersions(running, running) === null) {
    console.warn('[Abele] Invalid running changelog version')
    return null
  }
  try {
    const marker = store.read() as { schema?: unknown; lastRunVersion?: unknown } | null
    const previous =
      marker?.schema === 1 &&
      typeof marker.lastRunVersion === 'string' &&
      compareVersions(marker.lastRunVersion, running) !== null
        ? marker.lastRunVersion
        : null
    if (previous === running) return null
    store.write({ schema: 1, lastRunVersion: running })
    return previous && compareVersions(previous, running)! < 0
      ? { from: previous, to: running }
      : null
  } catch {
    console.warn('[Abele] Could not record changelog version; automatic offer suppressed')
    return null
  }
}
