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
  const finish = async (at) => {
    const start = startedAt
    startedAt = undefined
    const result = await command('Profiler.stop')
    const stopAcknowledgedAt = Date.now()
    const path = await save(result.profile)
    emit({
      event: 'cpu-profile',
      continuous,
      clock,
      startedAt: start,
      startAcknowledgedAt,
      endedAt: at,
      stopAcknowledgedAt,
      path,
    })
  }
  return {
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
          await finish(at)
        if (startedAt === undefined && (continuous || at - heartbeatAt >= stallMs)) {
          await command('Profiler.start')
          startedAt = at
          startAcknowledgedAt = Date.now()
          emit({ event: 'cpu-profile-start', startedAt: at })
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
          await finish(at)
        } catch {
          emit({ event: 'cpu-profile-unavailable' })
        }
    },
  }
}

const watches = new Map()
const evidencePorts = new Map()
exports.openEvidencePort = function (id, serializedConfig) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Evidence queues survive renderer navigation in the host.
  const { ipcMain } = require('electron')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Shared serialized evidence appends.
  const writer = require('./evidence-writer.cjs').writerFor(JSON.parse(serializedConfig).evidence)
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
const coverageWatches = new Map()
exports.beginReindexCoverage = (channel, id) => coverageWatches.get(channel)?.begin(id)
exports.endReindexCoverage = (channel) => coverageWatches.get(channel)?.end()
exports.unwatch = (channel) => watches.get(channel)?.()
exports.watch = async function (id, serializedConfig) {
  const config = JSON.parse(serializedConfig)
  // This module is loaded through the host's main-process remote bridge, never product code.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Main-process host module.
  const { webContents, ipcMain } = require('electron')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Disposable evidence files.
  const fs = require('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Unique private evidence names.
  const { randomUUID } = require('node:crypto')
  const wc = webContents.fromId(id),
    channel = `scale-heartbeat-${id}-${randomUUID()}`
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
  transport.attach('1.3')
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
    if (transport.isAttached()) transport.detach()
    emit({ event: 'cpu-profile-unavailable', reason: 'debugger clock unavailable' })
    return channel
  }
  const hashBreakpoints = new Set()
  const debuggerMessage = (_event, method, params) => {
    if (method === 'Debugger.breakpointResolved' && hashBreakpoints.has(params.breakpointId))
      emit({ event: 'javascript-hash-observer-ready', location: params.location })
  }
  if (config.javascriptHashTracepoints?.length) {
    transport.on('message', debuggerMessage)
    await transport.sendCommand('Debugger.enable')
    for (const lineNumber of config.javascriptHashTracepoints) {
      const binding = await transport.sendCommand('Debugger.setBreakpointByUrl', {
        url: 'plugin:abele',
        lineNumber,
        condition:
          '(()=>{try{globalThis.__scaleObserveIncrementalHash?.(this)}catch{}return false})()',
      })
      hashBreakpoints.add(binding.breakpointId)
      for (const location of binding.locations ?? [])
        emit({ event: 'javascript-hash-observer-ready', location })
    }
  }
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
      coverageWatches.delete(channel)
      if (config.javascriptHashTracepoints?.length)
        transport.removeListener('message', debuggerMessage)
      wc.removeListener('destroyed', destroyed)
      wc.removeListener('did-start-navigation', navigating)
      clearInterval(timer)
      ipcMain.removeListener(channel, heartbeat)
      try {
        await endCoverage()
        await profiler.close(Date.now())
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
    if (mainFrame && !inPlace) destroyed()
  }
  try {
    await transport.sendCommand('Profiler.enable')
    await transport.sendCommand('Profiler.setSamplingInterval', {
      interval: config.continuousCpu ? 10000 : 1000,
    })
    ipcMain.on(channel, heartbeat)
    profiler.heartbeat(Date.now())
    if (config.continuousCpu) await profiler.poll(Date.now())
    timer = setInterval(() => {
      void profiler.poll(Date.now())
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
    return channel
  } catch {
    await close()
    emit({ event: 'cpu-profile-unavailable' })
    return channel
  }
}
