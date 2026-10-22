import type { StateStore } from '@abele/sync-sdk/core'

export const STARTUP_STOP = 'abele-sync-token-state:startup-stop'
export function waitForStartupIndex(
  workspace: { onLayoutReady(callback: () => void): void },
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason instanceof Error ? signal.reason : new Error('Sync startup cancelled'))
    signal.addEventListener('abort', abort, { once: true })
    workspace.onLayoutReady(() => {
      signal.removeEventListener('abort', abort)
      if (!signal.aborted) resolve()
    })
  })
}
/** Snapshot, root and exclusions use local paths; map ledger paths before comparing them. */
export async function startupSafetyReason(
  state: StateStore,
  snapshot: (root: string) => Promise<{ files: readonly string[] }>,
  root: string,
  assertCurrent: () => void = () => {},
  excludedRoots: readonly string[] = [],
  ledgerOnly = false,
  localPath: (ledgerPath: string) => string = (path) => path
): Promise<string | null> {
  let known = 0
  const members = new Set<string>()
  // The host index never contains hidden paths or its configuration directory.
  // Compare the same eligible population on both sides, not the entire sync ledger.
  const comparable = (path: string) =>
    !path.split('/').some((part) => part.startsWith('.')) &&
    !excludedRoots.some((root) => path === root || path.startsWith(root + '/'))
  for await (const entry of state.all()) {
    assertCurrent()
    const path = localPath(entry.path)
    if (!comparable(path)) continue
    known++
    if (ledgerOnly) members.add(path)
  }
  // Small collections and first joins are handled by ordinary per-file safeguards.
  if (known < 100) return null
  const minimum = Math.ceil(known / 10)
  let present = 0
  const counted = new Set<string>()
  assertCurrent()
  const entries = await snapshot(root)
  assertCurrent()
  for (const file of entries.files) {
    assertCurrent()
    if (
      !comparable(file) ||
      (root && root !== '/' && file !== root && !file.startsWith(root + '/'))
    )
      continue
    if (!ledgerOnly) present++
    else {
      // Offloaded originals have a visible placeholder at their physical path.
      const original = file.endsWith('.abele-ref') ? file.slice(0, -'.abele-ref'.length) : file
      const member = members.has(file) ? file : original
      if (members.has(member)) counted.add(member)
    }
    if (ledgerOnly) present = counted.size
    if (present >= minimum) break
  }
  return present < minimum
    ? `Sync paused: only ${present} files are visible; this connection remembers ${known}. Check that the vault or folder is mounted and in the right place, then choose Resume.`
    : null
}
