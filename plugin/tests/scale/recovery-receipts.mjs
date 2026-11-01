// An interruption is not itself permission to re-read an installed file.
export function classifyRecoveryRead(read, boundaries) {
  const failed = { status: 'FAIL', reason: 'No matching committed boundary receipt evidence' }
  if (!read.target || !read.sha || !Number.isFinite(read.at)) return failed
  const boundary = boundaries
    .filter(
      (b) =>
        b.device === read.device && Number.isFinite(b.interruptedAt) && b.interruptedAt < read.at
    )
    .sort((a, b) => a.interruptedAt - b.interruptedAt)
    .at(-1)
  if (
    !boundary?.id ||
    boundary.complete !== true ||
    !Number.isFinite(boundary.at) ||
    !Number.isFinite(boundary.completedAt) ||
    boundary.at > boundary.completedAt ||
    boundary.completedAt > boundary.interruptedAt ||
    !Number.isFinite(boundary.recoveryEndedAt) ||
    read.at > boundary.recoveryEndedAt
  )
    return failed
  const targets = boundary.targets.filter((t) => t.target === read.target && t.sha === read.sha)
  if (targets.length !== 1) return failed
  const target = targets[0]
  if (target.pending !== true || target.usableIdentityReceipt !== false) return failed
  const privateStage = /\bnativeInstallBatch\b/.test(read.stack ?? '')
  if (
    privateStage
      ? !read.stage || read.stage !== target.stage
      : !/\bPullPlacer\.adoptExisting\w*\b/.test(read.stack ?? '')
  )
    return failed
  return {
    status: 'RECOVERY',
    interruptionId: boundary.id,
    target: target.target,
    stage: privateStage ? target.stage : undefined,
    boundaryCompletedAt: boundary.completedAt,
  }
}

// A SHA alone never selects a target when concurrent fingerprints are ambiguous.
export function linkFingerprint(read, entries) {
  const starts = new Map(
    entries
      .filter((x) => x.event === 'fingerprint-start' && x.device === read.device)
      .map((x) => [x.id, x])
  )
  const paths = new Set(
    entries
      .filter(
        (x) =>
          x.event === 'fingerprint-result' &&
          x.device === read.device &&
          x.sha === read.sha &&
          x.at >= read.at &&
          starts.get(x.id)?.at <= read.at
      )
      .map((x) => x.path)
  )
  return paths.size === 1 ? [...paths][0] : undefined
}
