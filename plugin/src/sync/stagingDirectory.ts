/** Private work files share the vault filesystem, but never a user content directory. */
export function stagingDirectory(configDir?: string): string {
  // Standalone adapters have no Vault. Vault compositions always supply their configDir.
  return configDir ? `${configDir}/plugins/abele/sync-staging` : '.abele-sync-work'
}
const leases = new Map<string, number>()
export function reserveStagingPath(path: string): () => void {
  leases.set(path, (leases.get(path) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const remaining = (leases.get(path) ?? 1) - 1
    if (remaining) leases.set(path, remaining)
    else leases.delete(path)
  }
}
export function stagingPathReserved(path: string): boolean {
  return leases.has(path)
}
