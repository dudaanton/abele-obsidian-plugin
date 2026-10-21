interface Connection {
  id: string
  localRoot?: string | null
  scope?: { kind: 'file' | 'folder' | 'group'; path: string } | null
}
export function retainedCopyCovered(
  records: readonly Connection[],
  live: ReadonlyMap<
    string,
    { covers(path: string): boolean; readonly coverageAvailable?: boolean }
  >,
  excluded: string,
  path: string
): boolean {
  return records.some((record) => {
    if (record.id === excluded) return false
    const runtime = live.get(record.id)
    if (runtime && runtime.coverageAvailable !== false) return runtime.covers(path)
    // Membership cannot be inferred from a group's path, especially while offline.
    if (!record.scope || record.scope.kind === 'group') return true
    if (record.scope.kind === 'file') return record.scope.path === path
    const root = record.localRoot ?? record.scope.path
    return root === '/' || path === root || path.startsWith(root + '/')
  })
}
