import { countPullOperation, emptyPullCounts } from '../../src/sync/pullOperationCounts'
import type { ExchangeTrace } from '../../src/sync/exchangeTrace'

/** The fixture's executable is reviewed by path even when its wire kind is attachment. */
export function firstFolderExpectedPulls(
  files: readonly { path: string; size: number; kind?: string }[]
) {
  const ordinary = files.filter((file) => !file.path.endsWith('.js'))
  const small = ordinary.filter((file) => file.size <= 1024 * 1024).length
  return {
    small,
    large: ordinary.length - small,
    requests: files.reduce((total, file) => total + Math.ceil(file.size / (1024 * 1024)), 0),
  }
}
/** Shared by live diagnostics and the pinned-code integration benchmark. No timing assumptions. */
export function smallPullCounts(operations: Record<string, number>, requests: number) {
  const counts = emptyPullCounts()
  for (const [operation, amount] of Object.entries(operations))
    countPullOperation(counts, operation, amount)
  counts.requests = requests
  return counts
}

export function assertPullEvidence(
  evidence: Pick<
    ReturnType<ExchangeTrace['snapshot']>['firstSync']['pulls'],
    'small' | 'large' | 'failed' | 'overlap' | 'contentRequests'
  >,
  expected: { small: number; large: number; requests: number }
): void {
  if (
    evidence.failed ||
    evidence.overlap ||
    evidence.small.count !== expected.small ||
    evidence.large.count !== expected.large ||
    evidence.contentRequests !== expected.requests
  )
    throw new Error(
      'Incomplete or repeated pull evidence: ' + JSON.stringify({ expected, evidence })
    )
  if (expected.small) {
    assertSmallPullBounds(evidence.small.min)
    assertSmallPullBounds(evidence.small.max)
  }
}

export function assertSmallPullBounds(counts: ReturnType<typeof smallPullCounts>): void {
  // A first pull needs one verified chunk, one crash-safe write, one publication and
  // journal create/retire. The production token host uses 14 bridge calls once
  // staging exists, 15 when it creates that directory. Include the central staged
  // write (formerly omitted by path attribution); the old append/seal path uses 18/23.
  const maximum = {
    requests: 1,
    writes: 1,
    publications: 1,
    journal: 2,
    bridge: 15,
    native: 16,
    preparationBridge: 2,
    preparationNative: 0,
  }
  for (const key of Object.keys(maximum) as (keyof typeof maximum)[]) {
    if (counts[key] > maximum[key])
      throw new Error(`Small pull ${key}: ${counts[key]} exceeds ${maximum[key]}`)
  }
  if (
    counts.requests !== 1 ||
    counts.writes !== 1 ||
    counts.publications !== 1 ||
    counts.journal !== 2
  )
    throw new Error('Small pull diagnostics are incomplete: ' + JSON.stringify(counts))
}

// A total guard catches an endlessly advancing loop; the inactivity guard catches a real stall.
export const FIRST_FOLDER_STALL_MS = 60_000
export const firstFolderBudget = (files: number) => 120_000 + files * 2_000
