import type { StateStore } from '@abele/sync-sdk/core'

export const STARTUP_STOP = 'abele-sync-token-state:startup-stop'
export async function startupSafetyReason(
  state: StateStore,
  list: (path: string) => Promise<{ files: string[]; folders: string[] }>,
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
  const pending = [root]
  const seen = new Set<string>()
  const privatePath = (path: string) =>
    path.split('/').includes('.abele-sync') ||
    privateRoots.some((root) => path === root || path.startsWith(root + '/'))
  while (pending.length && present < minimum) {
    assertCurrent()
    const path = pending.pop()
    if (path === undefined) break
    if (seen.has(path)) throw new Error('Repeated folder in startup listing')
    seen.add(path)
    const entries = await list(path)
    assertCurrent()
    for (const file of entries.files) {
      if (privatePath(file)) continue
      if (!ledgerOnly) present++
      else {
        // Offloaded originals have a visible placeholder at their physical path.
        const original = file.endsWith('.abele-ref') ? file.slice(0, -'.abele-ref'.length) : file
        const member = members.has(file) ? file : original
        if (members.has(member)) counted.add(member)
      }
    }
    if (ledgerOnly) present = counted.size
    pending.push(...entries.folders.filter((folder) => !privatePath(folder)))
  }
  return present < minimum
    ? `Sync paused: only ${present} files are visible; this connection remembers ${known}. Check that the vault or folder is mounted and in the right place, then choose Resume.`
    : null
}
