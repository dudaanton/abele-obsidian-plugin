// Host-side probes remain usable when the renderer's CLI handler cannot answer.
exports.streamSnapshot = async function (transport, write) {
  let writeError
  const chunk = (_event, method, params) => {
    if (method !== 'HeapProfiler.addHeapSnapshotChunk' || writeError) return
    try {
      write(params.chunk)
    } catch (error) {
      writeError = error
    }
  }
  transport.on('message', chunk)
  try {
    await transport.sendCommand('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
    if (writeError) throw writeError
  } finally {
    transport.removeListener('message', chunk)
  }
}
exports.probeRenderer = async function ({ command, state, emit, timeoutMs = 2000, request }) {
  const startedAt = Date.now()
  emit({ event: 'renderer-probe-start', startedAt, request, ...state() })
  const bounded = async (work) => {
    let timer
    try {
      return await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Probe timeout')), timeoutMs)
        }),
      ])
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }
  const [heap, response] = await Promise.all([
    bounded(command('Runtime.getHeapUsage')),
    bounded(command('Runtime.evaluate', { expression: '1+1', returnByValue: true })),
  ])
  emit({
    event: 'renderer-probe-end',
    startedAt,
    endedAt: Date.now(),
    request,
    heap,
    responsive: response?.result?.value === 2,
  })
}
