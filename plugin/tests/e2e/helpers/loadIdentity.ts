export interface LoadIdentity {
  timeOrigin: number
  loadId?: string
}

export function wasReloaded(before: LoadIdentity, after: LoadIdentity): boolean {
  if (before.loadId && after.loadId) return before.loadId !== after.loadId
  return Math.abs(before.timeOrigin - after.timeOrigin) > 1000
}
