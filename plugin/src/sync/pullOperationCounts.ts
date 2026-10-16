/** Fixed-size counters: no file names, request IDs or event history are retained. */
export const emptyPullCounts = () => ({
  requests: 0,
  writes: 0,
  publications: 0,
  journal: 0,
  bridge: 0,
  native: 0,
  preparationBridge: 0,
  preparationNative: 0,
})
export type PullCounts = ReturnType<typeof emptyPullCounts>
export const pullCountKeys = Object.keys(emptyPullCounts()) as (keyof PullCounts)[]
const requestPattern = /^GET \/v2\/files\/[^/]+\/content$/
const writePattern = /^(adapter (writeBinary|write|appendBinary)|native (open wx|write))$/
const publicationPattern = /^(adapter rename|native (rename|link))$/
export function countPullOperation(
  counts: PullCounts,
  operation: string,
  amount = 1,
  preparation = false
): void {
  if (requestPattern.test(operation)) counts.requests += amount
  if (writePattern.test(operation)) counts.writes += amount
  if (publicationPattern.test(operation)) counts.publications += amount
  if (operation === 'journal save') counts.journal += amount
  if (operation.startsWith('adapter '))
    counts[preparation ? 'preparationBridge' : 'bridge'] += amount
  if (operation.startsWith('native '))
    counts[preparation ? 'preparationNative' : 'native'] += amount
}
export const emptyPullSummary = () => ({
  count: 0,
  min: emptyPullCounts(),
  max: emptyPullCounts(),
  sum: emptyPullCounts(),
})
export function summarizePull(
  summary: ReturnType<typeof emptyPullSummary>,
  counts: PullCounts
): void {
  for (const key of pullCountKeys) {
    summary.min[key] = summary.count === 0 ? counts[key] : Math.min(summary.min[key], counts[key])
    summary.max[key] = Math.max(summary.max[key], counts[key])
    summary.sum[key] += counts[key]
  }
  summary.count++
}
