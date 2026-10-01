/** Plain parameter normalization shared by GitHub execution and primary-resource selection. */
export function whole(value: unknown, fallback: number, min = 1): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? Math.max(min, Math.floor(n)) : fallback
}
export const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
