/* eslint-disable @typescript-eslint/no-require-imports -- Disposable renderer instrumentation only. */
const fs = require('node:fs')
const { randomUUID } = require('node:crypto')
/* eslint-enable @typescript-eslint/no-require-imports -- Host-only imports end here. */

// Qualification observer only. Nothing is added to the product bundle.
exports.createEntryLedger = function ({ file, write, device, generation = randomUUID(),
  now = Date.now, performance = globalThis.performance, pluginAbsent = true }) {
  const append = write ?? (text => fs.appendFileSync(file, text))
  const epoch = now()
  let ring = [], sequence = 0, depth = 0, lastFlush = -Infinity, closed = false
  const stamp = () => ({ at: now(), monotonicMs: performance.now() })
  const record = (row, autoFlush = true) => {
    ring.push({ device, generation, ...stamp(), ...row })
    if (autoFlush && (ring.length >= 256 || now() - lastFlush >= 100)) flush()
  }
  const flush = () => {
    if (closed) return
    const startedAt = now()
    ring.push({ device, generation, ...stamp(), event: 'plugin-entry-ledger-checkpoint',
      complete: true, sequence })
    const entries = ring.filter(row => /^plugin-entry-(?:start|end)$/.test(row.event))
    const kinds = [...new Set(entries.map(row => row.kind).filter(Boolean))]
    const batch = { device, generation, event: 'plugin-entry-batch', epoch,
      kinds, records: entries.map(row => [row.event === 'plugin-entry-start' ? 0 : 1,
        row.id, row.at - epoch, Math.round(row.monotonicMs * 1000) / 1000,
        row.kind ? kinds.indexOf(row.kind) : -1]) }
    const other = ring.filter(row => !/^plugin-entry-(?:start|end)$/.test(row.event))
    const text = [...(entries.length ? [batch] : []), ...other].map(row => JSON.stringify(row)).join('\n') + '\n'
    ring = []
    append(text)
    lastFlush = now()
    ring.push({ device, generation, ...stamp(), event: 'plugin-entry-ledger-overhead',
      startedAt, endedAt: lastFlush })
  }
  const begin = kind => {
    // Persist pending evidence before entering product code, never inside its
    // measured span. Nested flushes also have explicit overhead intervals.
    if (ring.length >= 256 || now() - lastFlush >= 100) flush()
    const id = ++sequence
    depth++
    record({ event: 'plugin-entry-start', id, kind }, false)
    return id
  }
  const end = id => {
    depth--
    record({ event: 'plugin-entry-end', id })
  }
  const api = {
    begin, end, flush,
    active: () => depth > 0,
    wrap(fn, kind) {
      if (typeof fn !== 'function') return fn
      return function (...args) {
        const id = begin(kind)
        try { return Reflect.apply(fn, this, args) } finally { end(id) }
      }
    },
    teardown() { record({ event: 'renderer-lifecycle', kind: 'teardown' }, false); flush() },
    close() { flush(); closed = true },
  }
  record({ event: 'plugin-entry-ledger-ready', complete: true, pluginAbsent,
    coverageStartedAt: pluginAbsent ? performance.timeOrigin : now() })
  flush()
  return api
}

exports.decodeEntryBatch = row => row.event === 'plugin-entry-batch' ? row.records.map(record => ({
  device: row.device, generation: row.generation,
  event: record[0] === 0 ? 'plugin-entry-start' : 'plugin-entry-end', id: record[1],
  at: row.epoch + record[2], monotonicMs: record[3],
  ...(record[4] >= 0 ? { kind: row.kinds[record[4]] } : {}),
})) : [row]

exports.installEntryLedger = function ({ ledger, target = globalThis, Events, Component, Workspace, Plugin,
  EventEmitter, asyncHooks, isPluginCaller = () => {
    const limit = Error.stackTraceLimit
    try {
      Error.stackTraceLimit = 16
      return /plugin:abele(?:[/:]|\b)/.test(new Error().stack ?? '')
    } finally { Error.stackTraceLimit = limit }
  } }) {
  const undo = [], wrappers = new WeakMap()
  const owned = () => ledger.active() || isPluginCaller()
  const wrap = (fn, kind) => {
    if (typeof fn !== 'function') return fn
    let wrapped = wrappers.get(fn)
    if (!wrapped) { wrapped = ledger.wrap(fn, kind); wrappers.set(fn, wrapped) }
    return wrapped
  }
  const patch = (object, name, replace) => {
    if (!object || typeof object[name] !== 'function') return
    const original = object[name], replacement = replace(original)
    object[name] = replacement
    undo.push(() => { if (object[name] === replacement) object[name] = original })
  }
  const registration = (object, name, positions) => patch(object, name, original => function (...args) {
    if (owned()) for (const index of positions) args[index] = wrap(args[index], name)
    return Reflect.apply(original, this, args)
  })
  for (const name of ['on', 'once']) registration(Events?.prototype, name, [1])
  for (const name of ['on', 'addListener', 'prependListener'])
    patch(EventEmitter?.prototype, name, original => function (event, fn) {
      if (owned() && typeof fn === 'function') {
        const wrapped = wrap(fn, 'native event')
        wrapped.listener = fn.listener ?? fn
        fn = wrapped
      }
      return original.call(this, event, fn)
    })
  for (const name of ['off', 'removeListener'])
    patch(EventEmitter?.prototype, name, original => function (event, fn) {
      return original.call(this, event, wrappers.get(fn) ?? fn)
    })
  patch(Events?.prototype, 'off', original => function (name, fn, ...args) {
    return original.call(this, name, wrappers.get(fn) ?? fn, ...args)
  })
  registration(Workspace?.prototype, 'onLayoutReady', [0])
  for (const name of ['register', 'registerDomEvent', 'registerView', 'registerMarkdownPostProcessor',
    'registerMarkdownCodeBlockProcessor', 'registerCodeMirror', 'addRibbonIcon'])
    registration(Plugin?.prototype, name, [0, 1, 2])
  patch(Plugin?.prototype, 'addCommand', original => function (command) {
    if (owned()) {
      command = { ...command }
      for (const name of ['callback', 'checkCallback', 'editorCallback', 'editorCheckCallback'])
        command[name] = wrap(command[name], `command:${name}`)
    }
    return original.call(this, command)
  })
  for (const name of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback', 'queueMicrotask'])
    registration(target, name, [0])
  for (const name of ['then', 'catch', 'finally'])
    registration(target.Promise?.prototype, name, [0, 1])
  const listeners = new WeakMap()
  patch(target.EventTarget?.prototype, 'addEventListener', original => function (name, fn, options) {
    if (owned() && fn) {
      let callback = listeners.get(fn)
      if (!callback) {
        callback = typeof fn === 'function' ? wrap(fn, 'DOM listener') :
          { handleEvent: ledger.wrap(event => fn.handleEvent(event), 'DOM listener') }
        listeners.set(fn, callback)
      }
      fn = callback
    }
    return original.call(this, name, fn, options)
  })
  patch(target.EventTarget?.prototype, 'removeEventListener', original => function (name, fn, options) {
    return original.call(this, name, listeners.get(fn) ?? fn, options)
  })
  // Property callbacks do not go through addEventListener.
  for (const Class of new Set([target.IDBRequest, target.IDBOpenDBRequest, target.IDBTransaction,
    target.XMLHttpRequest, target.WebSocket, target.FileReader, target.Window, target.Document,
    target.HTMLElement, target.SVGElement])) {
    if (!Class) continue
    for (const name of Object.getOwnPropertyNames(Class.prototype).filter(key => key.startsWith('on'))) {
      const descriptor = Object.getOwnPropertyDescriptor(Class.prototype, name)
      if (!descriptor?.set || !descriptor.configurable) continue
      Object.defineProperty(Class.prototype, name, { ...descriptor, set(fn) {
        descriptor.set.call(this, owned() ? wrap(fn, name) : fn)
      } })
      undo.push(() => Object.defineProperty(Class.prototype, name, descriptor))
    }
  }
  for (const name of ['MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'PerformanceObserver']) {
    patch(target, name, Original => new Proxy(Original, { construct(Class, args, NewClass) {
      if (owned()) args[0] = wrap(args[0], name)
      return Reflect.construct(Class, args, NewClass)
    } }))
  }
  for (const name of ['load', 'unload']) patch(Component?.prototype, name, original => function (...args) {
    if (this.manifest?.id !== 'abele') return Reflect.apply(original, this, args)
    return ledger.wrap(original, `plugin:${name}`).apply(this, args)
  })
  // Native async/await bypasses Promise.prototype.then. V8 promise hooks exposed
  // by Node cover those continuations, and native completion callbacks as well.
  if (asyncHooks) {
    const jobs = new Set(), active = new Map()
    const hook = asyncHooks.createHook({
      init(id, type) { if (ledger.active() || (type === 'PROMISE' && isPluginCaller())) jobs.add(id) },
      before(id) { if (jobs.has(id)) active.set(id, ledger.begin('async continuation')) },
      after(id) { if (active.has(id)) { ledger.end(active.get(id)); active.delete(id) } },
      destroy(id) { jobs.delete(id) },
    })
    hook.enable()
    undo.push(() => hook.disable())
  }
  return () => { for (const restore of undo.reverse()) restore(); ledger.close() }
}
