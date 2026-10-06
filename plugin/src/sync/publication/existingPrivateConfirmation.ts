import {
  normalizedSpelling,
  type KnownRename,
  type LinkFact,
  type LinkSnapshot,
} from './LinkSnapshotStore'
/** Version comparison proposes a question, never permission. Only submitted LOCAL facts enter here. */
export function existingPrivateTargets(
  baseline: LinkSnapshot,
  local: LinkFact[],
  renames: KnownRename[]
): LinkFact[] {
  const old = baseline.kind === 'complete' ? baseline.facts : []
  const spellings = new Set(old.map((f) => normalizedSpelling(f.spelling)))
  const ids = new Set(old.flatMap((f) => (f.targetId ? [f.targetId] : [])))
  const paths = new Set(
    old.flatMap((f) =>
      [f.resolvedPath, f.spelling].filter((p): p is string => p !== null).map(normalizedSpelling)
    )
  )
  for (let n = 0; n < renames.length; n++)
    for (const r of renames)
      if (paths.has(normalizedSpelling(r.from))) paths.add(normalizedSpelling(r.to))
  const seen = new Set<string>()
  return local.filter((f) => {
    if (
      !f.targetId ||
      !f.resolvedPath ||
      f.resolution !== 'resolved' ||
      spellings.has(normalizedSpelling(f.spelling)) ||
      ids.has(f.targetId) ||
      paths.has(normalizedSpelling(f.resolvedPath)) ||
      seen.has(f.targetId)
    )
      return false
    seen.add(f.targetId)
    return true
  })
}
export interface ExistingPrivateCandidate {
  sponsorId: string
  targetId: string
  targetPath: string
}
