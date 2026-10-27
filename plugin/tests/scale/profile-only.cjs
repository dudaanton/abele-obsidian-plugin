// CPU sampling for a disposable restart probe; no renderer method wrappers are installed.
exports.startProfileOnly = async function (debuggerPort) {
  debuggerPort.attach('1.3')
  try {
    await debuggerPort.sendCommand('Performance.enable')
    const beforeAt = Date.now()
    const metrics = await debuggerPort.sendCommand('Performance.getMetrics')
    const afterAt = Date.now()
    const timestampMs = metrics.metrics.find((row) => row.name === 'Timestamp')?.value * 1000
    if (!Number.isFinite(timestampMs)) throw new Error('Debugger clock unavailable')
    await debuggerPort.sendCommand('Profiler.enable')
    await debuggerPort.sendCommand('Profiler.start')
    let stopped
    return {
      stop: () =>
        (stopped ??= (async () => {
          try {
            const { profile } = await debuggerPort.sendCommand('Profiler.stop')
            return { profile, clock: { beforeAt, afterAt, timestampMs } }
          } finally {
            debuggerPort.detach()
          }
        })()),
    }
  } catch (error) {
    debuggerPort.detach()
    throw error
  }
}
