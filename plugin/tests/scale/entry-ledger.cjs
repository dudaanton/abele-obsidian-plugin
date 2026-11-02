/* eslint-disable @typescript-eslint/no-require-imports -- Disposable renderer instrumentation only. */
const fs = require('node:fs')
const { randomUUID } = require('node:crypto')
/* eslint-enable @typescript-eslint/no-require-imports -- Host-only imports end here. */

// Qualification observer only. Nothing is added to the product bundle.
exports.createEntryLedger = function ({ file, write, device, generation = randomUUID(),
  now = Date.now, performance = globalThis.performance, pluginAbsent = true,
  capacity = 65536, schedule = setInterval, cancel = clearInterval, requireProductBridge = false }) {
  const epoch = now(), ring = new Float64Array(capacity * 6)
  const kinds = [], kindIds = new Map()
  let used = 0, sequence = 0, depth = 0, closed = false, dropped = 0
  let pending = Promise.resolve(), failure
  let bridgeReady = !requireProductBridge
  const append = text => {
    if (write) write(text)
    else pending = pending.then(() => fs.promises.appendFile(file, text)).catch(error => { failure = error })
  }
  const ready = () => append(JSON.stringify({ device, generation, at: now(),
    complete: bridgeReady, productRootsReady: bridgeReady, pluginAbsent,
    event: 'plugin-entry-ledger-ready', coverageStartedAt: pluginAbsent ? performance.timeOrigin : epoch }) + '\n')
  const kindId = kind => {
    if (typeof kind === "number") return kind
    if (!kind) return -1
    if (!kindIds.has(kind)) { kindIds.set(kind, kinds.length); kinds.push(kind) }
    return kindIds.get(kind)
  }
  const record = (type, id, at, monotonic, kind = -1, stop = 0) => {
    if (used === capacity) { dropped++; return }
    const offset = used++ * 6
    ring[offset] = type; ring[offset + 1] = id; ring[offset + 2] = at
    ring[offset + 3] = monotonic; ring[offset + 4] = kind; ring[offset + 5] = stop
  }
  const selfTime = startedAt => {
    const endedAt = now()
    if (endedAt > startedAt) record(2, 0, startedAt, 0, -1, endedAt)
  }
  const flush = () => {
    if (closed) return pending
    const startedAt = now(), records = [], overhead = []
    for (let i = 0; i < used; i++) {
      const at = i * 6
      if (ring[at] === 2) overhead.push({ device, generation,
        event: "plugin-entry-ledger-overhead", kind: 'wrapper self-time',
        startedAt: ring[at + 2], endedAt: ring[at + 5] })
      else records.push([ring[at], ring[at + 1], ring[at + 2] - epoch,
        ring[at + 3], ring[at + 4]])
    }
    used = 0
    const checkpoint = { device, generation, at: now(),
      event: "plugin-entry-ledger-checkpoint", complete: dropped === 0, dropped, sequence }
    const text = JSON.stringify({ device, generation, event: "plugin-entry-batch", epoch,
      kinds, records }) + "\n" + overhead.map(row => JSON.stringify(row) + "\n").join("") +
      JSON.stringify(checkpoint) + "\n"
    // Export is invoked only by the scheduled batch or an explicit lifecycle flush.
    // The renderer supplies IPC; a standalone file sink uses asynchronous append.
    append(text)
    append(JSON.stringify({ device, generation, event: 'plugin-entry-ledger-overhead',
      kind: 'batch export', startedAt, endedAt: now() }) + '\n')
    return pending
  }
  const begin = kind => {
    const before = now(), id = ++sequence
    depth++
    const code = kindId(kind), at = now()
    record(0, id, at, performance.now(), code)
    selfTime(before)
    return id
  }
  const end = id => {
    const before = now()
    depth--
    record(1, id, before, performance.now())
    selfTime(before)
  }
  const timer = schedule(flush, 50)
  timer?.unref?.()
  const api = {
    begin, end, flush, selfTime, selfStart: now, kindCode: kindId,
    invalidate() { dropped++ },
    productBridgeReady: () => bridgeReady,
    confirmProductBridge() { if (!bridgeReady) { bridgeReady = true; ready() } },
    active: () => depth > 0,
    wrap(fn, kind) {
      const before = now()
      if (typeof fn !== "function") { selfTime(before); return fn }
      const code = kindId(kind)
      function entered() {
        const id = begin(code)
        try { return fn.apply(this, arguments) } finally { end(id) }
      }
      selfTime(before)
      return entered
    },
    teardown() {
      append(JSON.stringify({ device, generation, at: now(),
        event: "renderer-lifecycle", kind: "teardown" }) + "\n")
      return flush()
    },
    close() {
      cancel(timer)
      flush(); closed = true
      return pending.then(() => { if (failure) throw failure })
    },
  }
  ready()
  return api
}

exports.decodeEntryBatch = row => row.event === 'plugin-entry-batch' ? row.records.map(record => ({
  device: row.device, generation: row.generation,
  event: record[0] === 0 ? 'plugin-entry-start' : 'plugin-entry-end', id: record[1],
  at: row.epoch + record[2], monotonicMs: record[3],
  ...(record[4] >= 0 ? { kind: row.kinds[record[4]] } : {}),
})) : [row]

// The host may call onload directly, bypassing Component.load entirely. Hook
// the actual exported class before the host constructs it; constructor-created
// callbacks and async onload continuations then inherit explicit ownership.
exports.wrapProductExport = function (value, ledger) {
  const Class = typeof value === 'function' ? value : value?.default
  if (typeof Class !== 'function') throw new Error('Qualification plugin class unavailable')
  const methods = ['onload', 'onunload']
  for (const name of methods) {
    if (typeof Class.prototype[name] === 'function')
      Class.prototype[name] = ledger.wrap(Class.prototype[name], `plugin:${name}`)
  }
  const Wrapped = new Proxy(Class, { construct(Target, args, NewTarget) {
    const id = ledger.begin('plugin construction')
    try {
      const instance = Reflect.construct(Target, args, NewTarget)
      for (const name of methods) if (Object.hasOwn(instance, name) && typeof instance[name] === 'function')
        instance[name] = ledger.wrap(instance[name], `plugin:${name}`)
      return instance
    } finally { ledger.end(id) }
  } })
  if (typeof value === 'function') { ledger.confirmProductBridge(); return Wrapped }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  descriptors.default = { value: Wrapped, enumerable: descriptors.default?.enumerable ?? true,
    configurable: true, writable: false }
  const namespace = Object.create(Object.getPrototypeOf(value), descriptors)
  ledger.confirmProductBridge()
  return namespace
}

exports.installEntryLedger = function ({ ledger, target = globalThis, Events, Component, Workspace, Plugin,
  EventEmitter, asyncHooks, isPluginCaller = () => false }) {
  // Evaluation/load are explicit roots; ownership propagates from those roots
  // through registered callbacks and native async jobs, without per-call stacks.
  const undo = [], wrappers = new WeakMap()
  const owned = () => {
    const before = ledger.selfStart()
    try { return ledger.active() || isPluginCaller() } finally { ledger.selfTime(before) }
  }
  const wrap = (fn, kind) => {
    const before = ledger.selfStart()
    try {
      if (typeof fn !== 'function') return fn
      let wrapped = wrappers.get(fn)
      if (!wrapped) { wrapped = ledger.wrap(fn, kind); wrappers.set(fn, wrapped) }
      return wrapped
    } finally { ledger.selfTime(before) }
  }
  const patch = (object, name, replace) => {
    if (!object || typeof object[name] !== 'function') return
    const original = object[name], replacement = replace(original)
    object[name] = replacement
    undo.push(() => { if (object[name] === replacement) object[name] = original })
  }
  const registration = (object, name, positions) => patch(object, name, original => function () {
    if (owned()) for (let i = 0; i < positions.length; i++) {
      const index = positions[i]
      arguments[index] = wrap(arguments[index], name)
    }
    return Reflect.apply(original, this, arguments)
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
  patch(Events?.prototype, 'off', original => function (name, fn) {
    arguments[1] = wrappers.get(fn) ?? fn
    return Reflect.apply(original, this, arguments)
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
  for (const name of ['load', 'unload']) patch(Component?.prototype, name, original => {
    const callback = wrap(original, `plugin:${name}`)
    return function () {
      if (this.manifest?.id !== 'abele') return Reflect.apply(original, this, arguments)
      return callback.apply(this, arguments)
    }
  })
  // Native async/await bypasses Promise.prototype.then. V8 promise hooks exposed
  // by Node cover those continuations, and native completion callbacks as well.
  if (asyncHooks) {
    const capacity = 262144, ids = new Float64Array(capacity), entries = new Float64Array(capacity)
    const kind = ledger.kindCode('async continuation')
    const hook = asyncHooks.createHook({
      init(id, type) {
        const before = ledger.selfStart()
        if (ledger.active() || (type === 'PROMISE' && isPluginCaller())) {
          const slot = id % capacity
          if (ids[slot] && ids[slot] !== id) ledger.invalidate()
          ids[slot] = id; entries[slot] = 0
        }
        ledger.selfTime(before)
      },
      before(id) {
        const before = ledger.selfStart(), slot = id % capacity
        if (ids[slot] === id) entries[slot] = ledger.begin(kind)
        ledger.selfTime(before)
      },
      after(id) {
        const before = ledger.selfStart(), slot = id % capacity
        if (ids[slot] === id && entries[slot]) { ledger.end(entries[slot]); entries[slot] = 0 }
        ledger.selfTime(before)
      },
      destroy(id) {
        const before = ledger.selfStart(), slot = id % capacity
        if (ids[slot] === id) { ids[slot] = 0; entries[slot] = 0 }
        ledger.selfTime(before)
      },
    })
    hook.enable()
    undo.push(() => hook.disable())
  }
  return () => { for (const restore of undo.reverse()) restore(); return ledger.close() }
}
