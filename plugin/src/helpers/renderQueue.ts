/** Serial, latest-value rendering. Requests carry no source: the render reads the latest one. */
export function createRenderQueue(
  render: () => Promise<void>,
  host: {
    now(): number
    schedule(fn: () => void, delay: number): () => void
    error(error: unknown): void
  },
  cadence = 50
) {
  let stopped = false
  let running = false
  let pending = false
  let streaming = false
  let lastStart = -Infinity
  let cancel: (() => void) | undefined

  const schedule = () => {
    cancel?.()
    cancel = undefined
    if (stopped || running || !pending) return
    const delay = streaming ? Math.max(0, lastStart + cadence - host.now()) : 0
    cancel = host.schedule(() => {
      void run()
    }, delay)
  }
  const run = async () => {
    cancel = undefined
    if (stopped) return
    running = true
    pending = false
    lastStart = host.now()
    try {
      await render()
    } catch (error) {
      host.error(error)
    } finally {
      running = false
      schedule()
    }
  }
  return {
    request(isStreaming: boolean, immediate = false) {
      if (stopped) return
      pending = true
      streaming = isStreaming
      if (immediate && !running) {
        cancel?.()
        void run()
      } else schedule()
    },
    stop() {
      stopped = true
      pending = false
      cancel?.()
      cancel = undefined
    },
  }
}
