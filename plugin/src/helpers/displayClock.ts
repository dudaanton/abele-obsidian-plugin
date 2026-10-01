/** Presentation clock only: stopping it must never stop domain timers or persistence. */
export interface ClockHost {
  now(): number
  schedule(callback: () => void, delay: number): () => void
}

/** One aligned wakeup for all subscribers, at the finest precision currently on screen. */
export function createDisplayClock(host: ClockHost) {
  const listeners = new Map<
    (now: number) => void,
    { period: number; phase: number; bucket: number }
  >()
  let cancel: (() => void) | undefined
  const schedule = () => {
    cancel?.()
    cancel = undefined
    if (!listeners.size) return
    const now = host.now()
    const delay = Math.min(
      ...Array.from(
        listeners.values(),
        ({ period, phase }) => period - ((((now - phase) % period) + period) % period)
      )
    )
    cancel = host.schedule(tick, delay)
  }
  const tick = () => {
    cancel = undefined
    const now = host.now()
    for (const [callback, state] of listeners) {
      const bucket = Math.floor((now - state.phase) / state.period)
      if (bucket !== state.bucket) {
        state.bucket = bucket
        callback(now)
      }
    }
    schedule()
  }
  return {
    subscribe(period: number, callback: (now: number) => void, phase = 0) {
      listeners.set(callback, { period, phase, bucket: Math.floor((host.now() - phase) / period) })
      callback(host.now())
      schedule()
      return () => {
        listeners.delete(callback)
        schedule()
      }
    },
  }
}
