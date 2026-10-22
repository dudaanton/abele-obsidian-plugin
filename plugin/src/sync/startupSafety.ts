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
export async function startupSafetyReason(
  state: StateStore,
  snapshot: (root: string) => Promise<{ files: readonly string[] }>,
  root: string,
  assertCurrent: () => void = () => {},
  privateRoots: readonly string[] = [],
  ledgerOnly = false
): Promise<string | null> {
  let known = 0
  const members = new Set<string>()
  for await (const entry of state.all()) {
    assertCurrent()
    known++
    if (ledgerOnly) members.add(entry.path)
  }
  // Small collections and first joins are handled by ordinary per-file safeguards.
  if (known < 100) return null
  const minimum = Math.ceil(known / 10)
  let present = 0
  const counted = new Set<string>()
  const privatePath = (path: string) =>
    path.split('/').includes('.abele-sync') ||
    privateRoots.some((root) => path === root || path.startsWith(root + '/'))
  assertCurrent()
  const entries = await snapshot(root)
  assertCurrent()
  for (const file of entries.files) {
    assertCurrent()
    if (
      privatePath(file) ||
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
