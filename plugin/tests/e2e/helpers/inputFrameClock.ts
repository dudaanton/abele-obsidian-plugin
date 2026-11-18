/** Default tiers reject freezes; tight frame timing is an opt-in measurement. */
export function assertInputFrameDelay(gapMs: number, measure = false, budgetMs = 90) {
  const limit = measure ? budgetMs : 500
  if (!Number.isFinite(gapMs) || (measure ? gapMs > limit : gapMs >= limit))
    throw new Error(`Gesture frame gap ${gapMs} ms exceeded the ${limit} ms limit`)
}

/** Self-contained for injection into the renderer's animation-frame probe. */
export function inputFrameClock() {
  let previous: { wall: number; cpu: number } | undefined
  return {
    wallMs: 0,
    cpuMs: 0,
    samples: 0,
    sample(wall: number, cpu: number | undefined, active: boolean) {
      if (!Number.isFinite(cpu)) throw new Error('Missing Performance ThreadTime evidence')
      if (active && previous) {
        this.samples++
        this.wallMs = Math.max(this.wallMs, wall - previous.wall)
        this.cpuMs = Math.max(this.cpuMs, (cpu! - previous.cpu) * 1000)
      }
      previous = active ? { wall, cpu: cpu! } : undefined
    },
  }
}
