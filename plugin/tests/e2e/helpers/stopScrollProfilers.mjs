/** Self-contained so the browser probe can embed it without importing a test module. */
export async function stopScrollProfilers(api, allocationsEnabled, timeoutMs = 10000) {
  const timings = {}
  const command = async (method) => {
    const start = performance.now()
    let timer
    try {
      return await Promise.race([
        api.sendCommand(method),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(method + ' exceeded ' + timeoutMs + ' ms')),
            timeoutMs
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
      timings[method] = performance.now() - start
    }
  }
  const [cpu, heap, metricsAfter] = await Promise.all([
    command('Profiler.stop'),
    allocationsEnabled ? command('HeapProfiler.stopSampling') : null,
    command('Performance.getMetrics'),
  ])
  return { profile: cpu.profile, allocations: heap?.profile ?? null, metricsAfter, timings }
}
