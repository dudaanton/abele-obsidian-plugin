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
      /(?:\(|\s)(?:app:\/\/obsidian\.md\/)?(?:app|obsidian)\.js:\d+:\d+\)?$/.test(s)
    )
    ? 'host'
    : 'unknown'
}
exports.classifyOrigin = classify
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
        if (startedAt !== undefined && (heartbeatAt >= startedAt || at - startedAt >= maxCaptureMs))
          await finish(at)
        else if (startedAt === undefined && at - heartbeatAt >= stallMs) {
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
  const emit = (e) =>
    fs.appendFileSync(
      config.evidence,
      JSON.stringify({ at: Date.now(), device: config.device, ...e }) + '\n'
    )
  if (!wc || wc.debugger.isAttached()) {
    emit({
      event: 'cpu-profile-unavailable',
      reason: 'debugger already attached or renderer absent',
    })
    return { channel, close() {} }
  }
  const transport = wc.debugger
  transport.attach('1.3')
  let timer,
    closed = false
  const profiler = exports.createStallProfiler({
    command: (name, params) => transport.sendCommand(name, params),
    emit,
    save: async (profile) => {
      const file = `${config.profileDirectory}/${config.device}-${randomUUID()}.cpuprofile`
      fs.mkdirSync(config.profileDirectory, { recursive: true })
      fs.writeFileSync(file, JSON.stringify(profile))
      return file
    },
  })
  const heartbeat = (event) => {
    if (event.sender.id === id) profiler.heartbeat(Date.now())
  }
  const close = async () => {
    if (closed) return
    closed = true
    clearInterval(timer)
    ipcMain.removeListener(channel, heartbeat)
    await profiler.close(Date.now())
    if (transport.isAttached()) transport.detach()
  }
  try {
    await transport.sendCommand('Profiler.enable')
    await transport.sendCommand('Profiler.setSamplingInterval', { interval: 1000 })
    ipcMain.on(channel, heartbeat)
    profiler.heartbeat(Date.now())
    timer = setInterval(() => {
      void profiler.poll(Date.now())
    }, 25)
    wc.once('destroyed', () => {
      void close().catch(() => {})
    })
    emit({ event: 'cpu-profile-ready', channel, stallMs: 75, sampleIntervalUs: 1000 })
    return { channel, close }
  } catch {
    await close()
    emit({ event: 'cpu-profile-unavailable' })
    return { channel, close }
  }
}
