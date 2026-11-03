// Creation stacks are captured synchronously, before the MutationObserver loses the caller.
function classify(stack) {
  if (typeof stack !== 'string') return 'unknown'
  if (/plugin:abele(?:[/:]|$)|[/\\]plugins[/\\]abele[/\\]main\.js/.test(stack)) return 'abele'
  if (/plugin:(?!scale-observer)/.test(stack)) return 'other-plugin'
  const frames = stack
    .split('\n')
    .filter((s) => /^\s+at /.test(s) && !/scale-observer|diagnostics\.cjs/.test(s))
  return frames.length &&
    frames.every((s) =>
      /(?:\(|\s)(?:(?:app:\/\/obsidian\.md\/)?(?:app|obsidian|enhance)\.js|app:\/\/obsidian\.md\/lib\/[\w.-]+\.js):\d+:\d+\)?$/.test(
        s
      )
    )
    ? 'host'
    : 'unknown'
}
exports.classifyOrigin = classify
exports.stateChunks = function (state, limit = 1024 ** 2) {
  // Leave room for receipt timestamps, device identity and chunk metadata.
  const budget = limit - 256
  if (Buffer.byteLength(JSON.stringify(state)) <= budget) return [state]
  const chunks = []
  for (const activity of state.activity ?? []) {
    const empty = () => ({ ...state, activity: [{ ...activity, refused: [], events: [] }] })
    let chunk = empty()
    let bytes = Buffer.byteLength(JSON.stringify(chunk))
    let count = 0
    if (bytes > budget) throw new Error('Activity value exceeds receipt budget')
    for (const key of ['refused', 'events']) {
      for (const value of activity[key] ?? []) {
        const size = Buffer.byteLength(JSON.stringify(value)) + 1
        if (bytes + size > budget) {
          if (!count) throw new Error('Activity value exceeds receipt budget')
          chunks.push(chunk)
          chunk = empty()
          bytes = Buffer.byteLength(JSON.stringify(chunk))
          count = 0
        }
        if (bytes + size > budget) throw new Error('Activity value exceeds receipt budget')
        chunk.activity[0][key].push(value)
        bytes += size
        count++
      }
    }
    chunks.push(chunk)
  }
  if (!chunks.length) throw new Error('Activity value exceeds receipt budget')
  return chunks.map((chunk, index) => ({
    ...chunk,
    activityChunk: { index, total: chunks.length },
  }))
}
exports.observeNotices = function (
  { Notice, Node, Element },
  capture = () => {
    const before = Error.stackTraceLimit
    try {
      Error.stackTraceLimit = 100
      return new Error().stack
    } finally {
      Error.stackTraceLimit = before
    }
  }
) {
  const origins = new WeakMap(),
    undo = []
  const remember = (node, method, stack) => {
    if (!node || typeof node !== 'object') return
    const origin = { source: classify(stack), method, stack }
    if (!origins.has(node) || origins.get(node).source === 'unknown') origins.set(node, origin)
    for (const child of node.querySelectorAll?.('.notice') ?? [])
      if (!origins.has(child)) origins.set(child, origin)
  }
  const wrap = (object, key, after, relevant = () => true) => {
    if (!object || typeof object[key] !== 'function') return
    const original = object[key]
    const wrapped = function (...args) {
      if (!relevant(args)) return original.apply(this, args)
      const stack = capture(),
        value = original.apply(this, args)
      after(this, args, stack)
      return value
    }
    object[key] = wrapped
    undo.push(() => {
      if (object[key] === wrapped) object[key] = original
    })
  }
  wrap(Notice?.prototype, 'setMessage', (notice, _args, stack) =>
    remember(notice.noticeEl, 'Notice.setMessage', stack)
  )
  const noticeNode = (args) =>
    args.some((node) => node?.matches?.('.notice') || node?.querySelector?.('.notice'))
  for (const key of ['appendChild', 'insertBefore', 'replaceChild'])
    wrap(
      Node?.prototype,
      key,
      (_self, args, stack) => remember(args[0], 'DOM.' + key, stack),
      noticeNode
    )
  for (const key of ['append', 'prepend', 'replaceChildren'])
    wrap(
      Element?.prototype,
      key,
      (_self, args, stack) => {
        for (const node of args) remember(node, 'DOM.' + key, stack)
      },
      noticeNode
    )
  return {
    origin: (node) => origins.get(node) ?? { source: 'unknown', method: null, stack: null },
    close: () => undo.reverse().forEach((f) => f()),
  }
}

// Lives in the Electron main process so a blocked renderer cannot stall its watchdog.
exports.createStallProfiler = function ({
  command,
  save,
  emit,
  stallMs = 75,
  maxCaptureMs = 10000,
  clock,
  continuous = false,
}) {
  let heartbeatAt,
    startedAt,
    startAcknowledgedAt,
    busy = false,
    disabled = false
  const finish = async (at, resume = false, reason = 'rotation') => {
    const start = startedAt
    const startAck = startAcknowledgedAt
    startedAt = undefined
    const stopRequestedAt = Date.now()
    const result = await command('Profiler.stop')
    const stopAcknowledgedAt = Date.now()
    if (resume) {
      await begin(Date.now())
      emit({ event: 'cpu-profile-gap', reason, startedAt: stopRequestedAt,
        endedAt: startAcknowledgedAt })
    }
    const path = await save(result.profile)
    emit({
      event: 'cpu-profile',
      continuous,
      clock,
      startedAt: start,
      startAcknowledgedAt: startAck,
      endedAt: at,
      stopAcknowledgedAt,
      path,
    })
  }
  const begin = async (at) => {
    await command('Profiler.start')
    startedAt = at
    startAcknowledgedAt = Date.now()
    emit({ event: 'cpu-profile-start', startedAt: at, startAcknowledgedAt })
  }
  return {
    running() { return startedAt !== undefined && !disabled },
    async restart(at) {
      while (busy) await new Promise(resolve => setTimeout(resolve, 10))
      if (disabled) throw new Error('Continuous profiler unavailable')
      busy = true
      try {
        if (startedAt !== undefined) await finish(at, true, 'restart')
        else await begin(at)
      } catch (error) {
        disabled = true
        emit({ event: 'cpu-profile-unavailable' })
        throw error
      } finally { busy = false }
    },
    heartbeat(at) {
      heartbeatAt = at
    },
    async poll(at) {
      if (busy || disabled || heartbeatAt === undefined) return
      busy = true
      try {
        if (
          startedAt !== undefined &&
          ((!continuous && heartbeatAt >= startedAt) || at - startedAt >= maxCaptureMs)
        )
          await finish(at, continuous)
        if (startedAt === undefined && (continuous || at - heartbeatAt >= stallMs)) {
          await begin(at)
        }
      } catch {
        disabled = true
        try {
          await command('Profiler.disable')
        } catch {
          /* detached target */
        }
        emit({ event: 'cpu-profile-unavailable' })
      } finally {
        busy = false
      }
    },
    async close(at) {
      while (busy) await new Promise((r) => setTimeout(r, 10))
      disabled = true
      if (startedAt !== undefined)
        try {
          await finish(at, false, 'close')
        } catch {
          emit({ event: 'cpu-profile-unavailable' })
        }
    },
  }
}

// Sampling includes collected objects; retained-heap snapshots alone cannot
// explain which code allocated the garbage collected during a long task.
exports.createAllocationProfiler = function ({ command, save, emit, now = Date.now,
  intervalMs = 1000, samplingInterval = 16384, rotationMs = 10000 }) {
  let startedAt, sessionAt, lastOrdinal = 0, busy, stopped = false, broken = false
  const startSampling = async () => {
    await command('HeapProfiler.startSampling', { samplingInterval,
      includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
    sessionAt = now()
    lastOrdinal = 0
  }
  const capture = async (stop = false) => {
    const before = now()
    try {
      const rotate = !stop && before - sessionAt >= rotationMs
      const { profile } = await command(stop || rotate ? 'HeapProfiler.stopSampling' : 'HeapProfiler.getSamplingProfile')
      if (!profile?.head || !Array.isArray(profile.samples)) throw new Error('Missing allocation samples')
      if (profile.samples.some(sample => !Number.isFinite(sample.ordinal) ||
        !Number.isFinite(sample.size) || sample.size < 0)) throw new Error('Invalid allocation samples')
      const samples = profile.samples.filter(sample => sample.ordinal > lastOrdinal)
      const previousOrdinal = lastOrdinal
      for (const sample of profile.samples) lastOrdinal = Math.max(lastOrdinal, sample.ordinal)
      const endedAt = now()
      const finalOrdinal = lastOrdinal
      if (rotate) {
        await startSampling()
        emit({ event: 'allocation-profile-gap', startedAt: endedAt, endedAt: sessionAt,
          reason: 'Bounded sampling session rotation' })
      }
      const path = await save({ head: profile.head, samples })
      emit({ event: 'allocation-profile', startedAt, endedAt, requestAt: before,
        firstOrdinal: previousOrdinal + 1, lastOrdinal: finalOrdinal, complete: !broken,
        samplingInterval, includeCollected: true, path })
      startedAt = rotate ? sessionAt : endedAt
    } catch {
      broken = true
      emit({ event: 'allocation-profile-unavailable', startedAt, endedAt: now() })
    }
  }
  return {
    async start() {
      await command('HeapProfiler.enable')
      await startSampling()
      startedAt = now()
      emit({ event: 'allocation-profile-ready', at: startedAt, samplingInterval })
    },
    async poll(at) {
      if (stopped || busy || startedAt === undefined || at - startedAt < intervalMs) return
      busy = capture()
      try { await busy } finally { busy = undefined }
    },
    async close() {
      stopped = true
      await busy
      if (startedAt !== undefined) await capture(true)
    },
  }
}

const watches = new Map()
const evidencePorts = new Map()
exports.openEvidencePort = function (id, serializedConfig) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Evidence queues survive renderer navigation in the host.
  const { ipcMain, app } = require('electron')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Shared serialized evidence appends.
  const writerModule = require('./evidence-writer.cjs')
  const writer = writerModule.writerFor(JSON.parse(serializedConfig).evidence)
  writerModule.drainOnQuit(app, writer)
  const key = `${id}:${JSON.parse(serializedConfig).evidence}`
  if (evidencePorts.has(key)) return evidencePorts.get(key)
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Disposable IPC identifier.
  const channel = `scale-evidence-${require('node:crypto').randomUUID()}`
  ipcMain.on(channel, (event, text) => {
    if (event.sender.id === id && typeof text === 'string') writer.enqueue(text)
  })
  ipcMain.handle(channel, async (event) => {
    if (event.sender.id !== id) throw new Error('Evidence sender mismatch')
    await writer.flush()
    return true
  })
  evidencePorts.set(key, channel)
  return channel
}
const ownedContents = new Map()
const continuousChannels = new Map()
const coverageWatches = new Map()
exports.beginReindexCoverage = (channel, id) => coverageWatches.get(channel)?.begin(id)
exports.endReindexCoverage = (channel) => coverageWatches.get(channel)?.end()
exports.unwatch = (channel) => watches.get(channel)?.()
exports.profileReady = (channel) => watches.has(channel)
exports.rendererExitReceipt = details => ({
  event: 'renderer-exit',
  reason: ['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure', 'memory-eviction']
    .includes(details?.reason) ? details.reason : 'unknown',
  exitCode: Number.isInteger(details?.exitCode) ? details.exitCode : null,
})
exports.watch = async function (id, serializedConfig) {
  const config = JSON.parse(serializedConfig)
  const watchStartedAt = Date.now()
  // This module is loaded through the host's main-process remote bridge, never product code.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Main-process host module.
  const { webContents, ipcMain } = require('electron')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Disposable evidence files.
  const fs = require('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Unique private evidence names.
  const { randomUUID } = require('node:crypto')
  const wc = webContents.fromId(id),
    channel = `scale-heartbeat-${id}-${randomUUID()}`
  const existing = continuousChannels.get(id)
  if (config.continuousCpu && existing?.evidence === config.evidence) {
    // The same webContents survives a reload. Keep its active CPU capture across
    // generations; stopping it here would leave the new bundle's load unprofiled.
    return existing.channel
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- The renderer and profiler share one host-owned append queue.
  const evidence = require('./evidence-writer.cjs').writerFor(config.evidence)
  const emit = (e) =>
    evidence.enqueue(JSON.stringify({ at: Date.now(), device: config.device, ...e }) + '\n')
  await ownedContents.get(id)?.()
  if (!wc || wc.debugger.isAttached()) {
    emit({
      event: 'cpu-profile-unavailable',
      reason: 'debugger already attached or renderer absent',
    })
    return channel
  }
  const transport = wc.debugger
  wc.once('render-process-gone', (_event, details) => emit(exports.rendererExitReceipt(details)))
  transport.attach('1.3')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Host process state, independent of renderer IPC.
  const { app } = require('electron')
  let probeBusy = false,
    heapTimer,
    requestId,
    snapshotBusy = false
  const controlFile = `${config.profileDirectory}/control-${config.device}.json`
  const probe = async (request) => {
    if (probeBusy) return
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Independent host-side diagnostic probes.
    const { probeRenderer } = require('./heap.cjs')
    probeBusy = true
    try {
      await probeRenderer({
        command: (name, params) => transport.sendCommand(name, params),
        emit,
        request,
        state: () => ({
          mainPid: process.pid,
          rendererPid: wc.getOSProcessId(),
          destroyed: wc.isDestroyed(),
          loading: wc.isLoading(),
          mainMemory: process.memoryUsage(),
          appMetrics: app.getAppMetrics(),
        }),
      })
    } finally {
      probeBusy = false
    }
  }
  const takeHeap = async (request) => {
    if (snapshotBusy) return
    snapshotBusy = true
    const file = `${config.profileDirectory}/${config.device}-${randomUUID()}.heapsnapshot`
    fs.mkdirSync(config.profileDirectory, { recursive: true })
    const fd = fs.openSync(file, 'wx')
    let bytes = 0
    emit({ event: 'heap-snapshot-start', request, file })
    try {
      // Snapshot chunks are written immediately so the observer never retains a second heap-sized string.
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Bounded snapshot streaming in the host.
      await require('./heap.cjs').streamSnapshot(transport, (chunk) => {
        bytes += fs.writeSync(fd, chunk)
      })
      emit({ event: 'heap-snapshot-end', request, file, bytes, complete: true })
      fs.writeFileSync(
        `${controlFile}.done`,
        JSON.stringify({ id: request.id, file, bytes, complete: true })
      )
    } catch {
      emit({ event: 'heap-snapshot-end', request, file, bytes, complete: false })
      fs.writeFileSync(`${controlFile}.done`, JSON.stringify({ id: request.id, complete: false }))
    } finally {
      fs.closeSync(fd)
      snapshotBusy = false
    }
  }
  if (config.heapDiagnostics) {
    fs.mkdirSync(config.profileDirectory, { recursive: true })
    let tick = 0
    heapTimer = setInterval(() => {
      if (++tick % 30 === 0) void probe({ kind: 'periodic' }).catch(() => {})
      fs.promises
        .readFile(controlFile, 'utf8')
        .then(JSON.parse)
        .then((request) => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports -- Ignore requests belonging to the previous renderer generation.
          if (!require('./heap.cjs').freshRequest(request, watchStartedAt)) return
          if (request.id === requestId) return
          requestId = request.id
          if (request.kind === 'snapshot') void takeHeap(request).catch(() => {})
          else void probe(request).catch(() => {})
        })
        .catch(() => {})
    }, 1000)
  }
  let timer,
    closed = false
  let clock
  try {
    await transport.sendCommand('Performance.enable')
    const beforeAt = Date.now()
    const metrics = await transport.sendCommand('Performance.getMetrics')
    const afterAt = Date.now()
    const timestampMs = metrics.metrics.find((m) => m.name === 'Timestamp')?.value * 1000
    if (!Number.isFinite(timestampMs)) throw new Error('Debugger clock unavailable')
    clock = { beforeAt, afterAt, timestampMs }
  } catch {
    clearInterval(heapTimer)
    if (transport.isAttached()) transport.detach()
    emit({ event: 'cpu-profile-unavailable', reason: 'debugger clock unavailable' })
    return channel
  }
  const closeHashTracepoints = await exports.armHashTracepoints(
    transport,
    config.strictRestartMeasurement ? [] : config.javascriptHashTracepoints,
    config.javascriptHashBoundary,
    emit,
    exports.caughtExceptionPauseFile(config)
  )
  const profiler = exports.createStallProfiler({
    clock,
    continuous: config.continuousCpu === true,
    maxCaptureMs: config.continuousCpu ? 60000 : 10000,
    command: (name, params) => transport.sendCommand(name, params),
    emit,
    save: async (profile) => {
      const file = `${config.profileDirectory}/${config.device}-${randomUUID()}.cpuprofile`
      fs.mkdirSync(config.profileDirectory, { recursive: true })
      fs.writeFileSync(file, JSON.stringify(profile))
      return file
    },
  })
  const allocations = config.continuousCpu ? exports.createAllocationProfiler({
    command: (name, params) => transport.sendCommand(name, params), emit,
    save: async profile => {
      const file = `${config.profileDirectory}/${config.device}-${randomUUID()}.heapprofile`
      await fs.promises.mkdir(config.profileDirectory, { recursive: true })
      await fs.promises.writeFile(file, JSON.stringify(profile))
      return file
    },
  }) : undefined
  let coverageId
  const endCoverage = async () => {
    if (!coverageId) return
    const id = coverageId
    coverageId = undefined
    try {
      const result = await transport.sendCommand('Profiler.takePreciseCoverage')
      await transport.sendCommand('Profiler.stopPreciseCoverage')
      const file = `${config.profileDirectory}/${config.device}-${randomUUID()}.coverage.json`
      fs.mkdirSync(config.profileDirectory, { recursive: true })
      fs.writeFileSync(file, JSON.stringify(result))
      emit({ event: 'reindex-js-coverage', id, file })
    } catch {
      emit({ event: 'reindex-js-coverage-unavailable', id })
    }
  }
  const beginCoverage = async (id) => {
    // Persist the preceding sync/UI work before the awaited reindex action can
    // replace V8's context. A later stop may return only the new bootstrap tail.
    if (config.continuousCpu) await profiler.restart(Date.now())
    if (config.preciseHashCoverage === false) {
      emit({
        event: 'reindex-js-coverage-skipped',
        id,
        reason: 'Actual digest observation enabled; full function counters disabled',
      })
      return false
    }
    if (coverageId) await endCoverage()
    try {
      await transport.sendCommand('Profiler.startPreciseCoverage', {
        callCount: true,
        detailed: true,
      })
      coverageId = id
      emit({ event: 'reindex-js-coverage-ready', id })
      return true
    } catch {
      emit({ event: 'reindex-js-coverage-unavailable', id })
      return false
    }
  }
  const heartbeat = (event) => {
    if (event.sender.id === id) profiler.heartbeat(Date.now())
  }
  let closing
  const close = () => {
    if (closed) return closing
    closed = true
    closing = (async () => {
      watches.delete(channel)
      continuousChannels.delete(id)
      coverageWatches.delete(channel)
      closeHashTracepoints()
      wc.removeListener('destroyed', destroyed)
      wc.removeListener('did-start-navigation', navigating)
      clearInterval(timer)
      clearInterval(heapTimer)
      ipcMain.removeListener(channel, heartbeat)
      try {
        await endCoverage()
        await profiler.close(Date.now())
        await allocations?.close()
      } finally {
        if (transport.isAttached()) transport.detach()
        if (ownedContents.get(id) === close) ownedContents.delete(id)
      }
    })()
    return closing
  }
  const destroyed = () => {
    void close().catch(() => {})
  }
  const navigating = (_event, _url, inPlace, mainFrame) => {
    if (!mainFrame || inPlace) return
    // A webContents can survive while V8 replaces its renderer context. The
    // previous channel's acknowledgement is not proof of a new CPU session.
    // Close it now; watch() waits for this close before attaching the new one.
    emit({ event: 'renderer-navigation' })
    destroyed()
  }
  try {
    await transport.sendCommand('Profiler.enable')
    await transport.sendCommand('Profiler.setSamplingInterval', {
      interval: config.continuousCpu ? 10000 : 1000,
    })
    ipcMain.on(channel, heartbeat)
    profiler.heartbeat(Date.now())
    if (config.continuousCpu) await profiler.poll(Date.now())
    if (config.continuousCpu && !profiler.running()) throw new Error('Profiler start failed')
    await allocations?.start()
    timer = setInterval(() => {
      void profiler.poll(Date.now())
      void allocations?.poll(Date.now())
    }, 25)
    wc.once('destroyed', destroyed)
    wc.on('did-start-navigation', navigating)
    emit({
      event: 'cpu-profile-ready',
      channel,
      stallMs: 75,
      sampleIntervalUs: config.continuousCpu ? 10000 : 1000,
      continuous: config.continuousCpu === true,
    })
    watches.set(channel, close)
    coverageWatches.set(channel, { begin: beginCoverage, end: endCoverage })
    ownedContents.set(id, close)
    if (config.continuousCpu) continuousChannels.set(id, { channel, evidence: config.evidence })
    return channel
  } catch {
    await close()
    emit({ event: 'cpu-profile-unavailable' })
    return channel
  }
}

exports.visibleStatus = (document) =>
  [
    ...document.querySelectorAll(
      '.abele-sync-status, .abele-sync-window__line, .abele-sync-row__status'
    ),
  ]
    .filter((el) => el.getClientRects().length > 0)
    .map((el) => ({
      text: el.textContent?.trim() ?? '',
      label: el.getAttribute('aria-label'),
      selector: el.className,
    }))

exports.classificationSnapshot = (activity) =>
  Object.entries(activity ?? {}).map(([id, value]) => ({
    id,
    classification: value.classification ?? null,
  }))

exports.caughtExceptionPauseFile = (config) =>
  config.captureCaughtExceptions === true ? config.failureArmed ?? null : null

exports.armHashTracepoints = async function (transport, lines, boundary, emit, failureArmed) {
  if (!lines?.length) return () => {}
  if (!Number.isInteger(boundary)) throw new Error('Hash evaluation boundary unavailable')
  const breakpoints = new Set()
  let gate
  const message = async (_event, method, params) => {
    if (method === 'Debugger.paused' && ['exception', 'promiseRejection'].includes(params.reason)) {
      try {
        const properties = params.data?.objectId
          ? await transport.sendCommand('Runtime.getProperties', { objectId: params.data.objectId, ownProperties: true })
          : null
        emit({ event: 'caught-startup-exception', data: params.data,
          properties: properties?.result, callFrames: params.callFrames })
      } finally { await transport.sendCommand('Debugger.resume') }
      return
    }
    if (method === 'Debugger.breakpointResolved' && breakpoints.has(params.breakpointId))
      emit({ event: 'javascript-hash-observer-ready', location: params.location })
    if (method !== 'Debugger.paused' || !params.hitBreakpoints?.includes(gate)) return
    const startedAt = Date.now()
    try {
      const scriptId = params.callFrames?.[0]?.location?.scriptId
      if (!scriptId) throw new Error('Hash script identity unavailable')
      for (const lineNumber of lines) {
        const binding = await transport.sendCommand('Debugger.setBreakpoint', {
          location: { scriptId, lineNumber },
          condition:
            '(()=>{try{globalThis.__scaleObserveIncrementalHash?.(this)}catch{}return false})()',
        })
        breakpoints.add(binding.breakpointId)
        for (const location of binding.actualLocation ? [binding.actualLocation] : [])
          emit({ event: 'javascript-hash-observer-ready', location })
      }
      // Never evaluate debuggee JavaScript while paused: native async hooks
      // require balanced callback scopes. The installed bundle schedules its
      // hash constructor warm-up after normal evaluation instead.
    } catch (error) {
      emit({ event: 'javascript-hash-observer-unavailable', reason: String(error) })
    } finally {
      // This is harness latency, retained separately rather than hidden in startup.
      emit({ event: 'javascript-hash-tracepoint-setup', startedAt, endedAt: Date.now() })
      await transport.sendCommand('Debugger.resume')
    }
  }
  transport.on('message', message)
  await transport.sendCommand('Debugger.enable')
  if (failureArmed) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Main-process diagnostic arming receipt.
    const fs = require('node:fs')
    if (fs.existsSync(failureArmed)) {
      await transport.sendCommand('Debugger.setPauseOnExceptions', { state: 'all' })
      emit({ event: 'caught-exception-observer-ready' })
    }
  }
  const binding = await transport.sendCommand('Debugger.setBreakpointByUrl', {
    url: 'plugin:abele',
    lineNumber: boundary,
  })
  gate = binding.breakpointId
  return () => transport.removeListener('message', message)
}

// Preserve the original scheduling receipts before the bounded runtime ring rotates.
exports.observeSyncTrace = function (trace, emit) {
  const record = (line, seeded) => {
    if (/^sync: (?:request |cycle )/.test(line))
      emit({ event: 'engine-sync-diagnostic', line, seeded })
  }
  for (let i = 0; i < trace.lineCount; i++)
    record(
      trace.lines[(trace.lineNext - trace.lineCount + i + trace.lines.length) % trace.lines.length],
      true
    )
  const original = trace.log
  const wrapped = function (line) {
    record(line, false)
    return original.call(this, line)
  }
  trace.log = wrapped
  return () => {
    if (trace.log === wrapped) trace.log = original
  }
}
