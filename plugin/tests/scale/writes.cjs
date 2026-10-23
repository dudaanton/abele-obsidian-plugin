/* eslint-disable @typescript-eslint/no-require-imports -- Disposable host observer. */
const path = require('node:path')
const { constants } = require('node:fs')
/* eslint-enable @typescript-eslint/no-require-imports -- Host imports end here. */

// Observe the desktop adapter/native ports before the product binds them. Never replace
// an operation's arguments, result, error or scheduling with synthetic filesystem behavior.
exports.observeWrites = function (adapter, emit) {
  const root = path.resolve(adapter.getBasePath())
  const generation = `${Date.now()}-${Math.random()}`
  const restore = []
  let sequence = 0
  const bytes = (value) =>
    typeof value === 'string' ? Buffer.byteLength(value) : (value?.byteLength ?? null)
  const relative = (value) => {
    if (typeof value !== 'string') return null
    const full = path.resolve(value)
    return full.startsWith(root + path.sep) ? path.relative(root, full) : null
  }
  const wrap = (object, key, layer, locate, amount) => {
    const original = object[key]
    if (typeof original !== 'function') return
    const wrapped = function (...args) {
      const file = locate(args)
      const id = ++sequence
      if (file != null)
        emit({
          event: 'write-start',
          generation,
          id,
          method: layer + '.' + key,
          path: file,
          bytes: amount(args),
        })
      let answer
      try {
        answer = original.apply(this, args)
      } catch (error) {
        if (file != null) emit({ event: 'write-finish', generation, id, failed: true })
        throw error
      }
      return Promise.resolve(answer).then(
        (value) => {
          if (file != null) emit({ event: 'write-finish', generation, id })
          return value
        },
        (error) => {
          if (file != null) emit({ event: 'write-finish', generation, id, failed: true })
          throw error
        }
      )
    }
    object[key] = wrapped
    if (object[key] !== wrapped) throw new Error('Observer port is not writable')
    restore.push(() => {
      if (object[key] === wrapped) object[key] = original
    })
  }
  try {
    const native = adapter.fsPromises
    if (
      !native ||
      typeof native.open !== 'function' ||
      typeof native.rename !== 'function' ||
      typeof adapter.writeBinary !== 'function'
    )
      throw new Error('Desktop write ports unavailable')
    for (const name of ['write', 'writeBinary', 'append', 'appendBinary'])
      wrap(
        adapter,
        name,
        'adapter',
        (args) => (typeof args[0] === 'string' ? relative(path.join(root, args[0])) : null),
        (args) => bytes(args[1])
      )
    for (const name of ['rename', 'copy'])
      wrap(
        adapter,
        name,
        'adapter',
        (args) => relative(path.join(root, args[1])),
        () => 0
      )
    for (const name of ['writeFile', 'appendFile'])
      wrap(
        native,
        name,
        'native',
        (args) => relative(args[0]),
        (args) => bytes(args[1])
      )
    for (const name of ['rename', 'link', 'copyFile'])
      wrap(
        native,
        name,
        'native',
        (args) => relative(args[1]),
        () => 0
      )
    const originalOpen = native.open
    const open = async function (...args) {
      const file = relative(args[0])
      const mutates =
        typeof args[1] === 'string'
          ? /[wa+]/.test(args[1])
          : !!(
              args[1] &
              (constants.O_WRONLY |
                constants.O_RDWR |
                constants.O_APPEND |
                constants.O_CREAT |
                constants.O_TRUNC)
            )
      const id = ++sequence
      if (file != null && mutates)
        emit({ event: 'write-start', generation, id, method: 'native.open', path: file, bytes: 0 })
      let handle
      try {
        handle = await originalOpen.apply(this, args)
      } finally {
        if (file != null && mutates) emit({ event: 'write-finish', generation, id })
      }
      if (file != null && mutates) {
        try {
          wrap(
            handle,
            'write',
            'handle',
            () => file,
            (a) => (typeof a[2] === 'number' ? a[2] : bytes(a[0]))
          )
          wrap(
            handle,
            'writev',
            'handle',
            () => file,
            (a) => a[0].reduce((sum, b) => sum + bytes(b), 0)
          )
          for (const name of ['writeFile', 'appendFile'])
            wrap(
              handle,
              name,
              'handle',
              () => file,
              (a) => bytes(a[0])
            )
          wrap(
            handle,
            'truncate',
            'handle',
            () => file,
            () => 0
          )
        } catch {
          emit({ event: 'write-observer-error', generation })
        }
      }
      return handle
    }
    native.open = open
    if (native.open !== open) throw new Error('Observer open port is not writable')
    restore.push(() => {
      if (native.open === open) native.open = originalOpen
    })
    if (adapter.fsPromises !== native) throw new Error('Observer native port is not stable')
    emit({
      event: 'write-observer-ready',
      generation,
      coverage: 'desktop adapter writes, native promise writes/installs, and opened native handles',
    })
  } catch {
    emit({ event: 'write-observer-error', generation })
  }
  return () => {
    for (const undo of restore.reverse()) undo()
  }
}
