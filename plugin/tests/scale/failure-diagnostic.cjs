// Diagnostic-only wrappers: preserve the product call and retain its caller before awaits.
exports.serialize = function serialize(value, seen = new WeakSet()) {
  if (typeof value === 'bigint') return String(value)
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  if (value instanceof Map) return [...value].map(([key, item]) => [key, serialize(item, seen)])
  if (value instanceof Set) return [...value].map(item => serialize(item, seen))
  const result = Array.isArray(value) ? [] : {}
  for (const key of new Set([...Object.keys(value), ...(value instanceof Error ? ['name', 'message', 'stack', 'cause', 'code'] : [])])) {
    try { result[key] = serialize(value[key], seen) } catch { result[key] = '[unreadable]' }
  }
  return result
}

exports.shouldWrapFingerprints = config =>
  config.failureDiagnostic && config.captureFingerprintCallers === true

exports.wrapFingerprints = function (Class, emit) {
  if (!Class?.prototype || Class.prototype.__scaleFingerprintWrapped) return
  Object.defineProperty(Class.prototype, '__scaleFingerprintWrapped', { value: true })
  let sequence = 0
  for (const key of ['fingerprint', 'fingerprintFresh', Symbol.for('abele.sync.fingerprint-fresh-v1'), Symbol.for('abele.sync.fingerprint-pull-v1')]) {
    const original = Class.prototype[key]
    if (typeof original !== 'function') continue
    Class.prototype[key] = function (...args) {
      const id = `${Date.now()}:${++sequence}`
      const method = String(key)
      const stack = new Error().stack
      emit({ event: 'fingerprint-start', id, method, path: args[0], fresh: args[2], stack })
      const result = original.apply(this, args)
      if (!result?.then) return result
      return result.then(value => {
        emit({ event: 'fingerprint-result', id, method, path: args[0], sha: value?.sha, bytes: value?.size, stack })
        return value
      }, error => {
        emit({ event: 'fingerprint-error', id, method, path: args[0], error: exports.serialize(error), stack })
        throw error
      })
    }
  }
  emit({ event: 'fingerprint-observer-ready', className: Class.name })
}

exports.captureFailures = function ({ target, console, emit, getState, writeFatal, freeze, armed }) {
  const undo = []
  let captured = false
  for (const method of ['error', 'warn']) {
    const original = console[method]
    const wrapped = function (...args) {
      emit({ event: 'renderer-console', method, args: exports.serialize(args), stack: new Error().stack })
      return original.apply(this, args)
    }
    console[method] = wrapped
    undo.push(() => { if (console[method] === wrapped) console[method] = original })
  }
  for (const type of ['error', 'unhandledrejection']) {
    const listener = event => emit({ event: 'renderer-exception', type,
      message: event.message, filename: event.filename, lineno: event.lineno, colno: event.colno,
      error: exports.serialize(event.error), reason: exports.serialize(event.reason), stack: new Error().stack })
    target.addEventListener(type, listener)
    undo.push(() => target.removeEventListener(type, listener))
  }
  return {
    poll() {
      if (captured || !armed()) return
      const state = getState()
      if (!state?.rows?.some(row => row.status === 'error')) return
      captured = true
      writeFatal({ at: Date.now(), state: exports.serialize(state) })
      freeze()
    },
    close() { for (const restore of undo.reverse()) restore() },
  }
}
