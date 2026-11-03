/** Revoking a test job stops its next UI polling checkpoint, never a product safety guard. */
export function cancelSyncJobs(jobs: Record<string, unknown>, current: string): void {
  for (const key of Object.keys(jobs))
    if (key.startsWith('__abeleSyncJob') && key !== current) delete jobs[key]
}
export function assertSyncJob(jobs: Record<string, unknown>, key?: string): void {
  if (key && !Object.hasOwn(jobs, key)) throw new Error('Live sync job was cancelled')
}
export function finishSyncJob(jobs: Record<string, unknown>, key: string, result: unknown): void {
  if (Object.hasOwn(jobs, key)) jobs[key] = result
}
