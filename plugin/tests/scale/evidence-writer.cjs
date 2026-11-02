// One serialized asynchronous append queue per evidence file, owned by the host process.
exports.createEvidenceWriter = function (append, { maximumBytes = 128 * 1024 ** 2 } = {}) {
  let queue = [],
    bytes = 0,
    active,
    error,
    timer
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    if (active) return active
    active = (async () => {
      while (queue.length && !error) {
        const batch = []
        let size = 0
        let count = 0
        while (count < queue.length && size < 256 * 1024) {
          const row = queue[count++]
          batch.push(row)
          size += Buffer.byteLength(row)
        }
        queue.splice(0, count)
        try {
          await append(batch.join(''))
        } catch (cause) {
          error = cause
        }
        bytes -= size
      }
      if (error) throw error
    })().finally(() => {
      active = undefined
      if (queue.length && !error)
        timer = setTimeout(() => {
          void flush().catch(() => {})
        }, 0)
    })
    return active
  }
  return {
    enqueue(text) {
      if (error) return
      const size = Buffer.byteLength(text)
      if (bytes + size > maximumBytes) {
        error = new Error('Evidence queue exceeded its bounded capacity')
        return
      }
      bytes += size
      queue.push(text)
      if (!active && timer === undefined)
        timer = setTimeout(() => {
          void flush().catch(() => {})
        }, 0)
    },
    flush,
  }
}

const writers = new Map()
const quitDrains = new WeakMap()
// The renderer may already be gone. Drain host-owned queues after window unload
// and before the host exits, including the final asynchronous ledger batch.
exports.drainOnQuit = function (app, writer) {
  if (!app?.on) return
  let state = quitDrains.get(app)
  if (!state) {
    state = { writers: new Set(), done: undefined, failures: 0 }
    const drain = event => {
      event.preventDefault()
      if (state.done) return
      state.done = (async () => {
        await new Promise(resolve => setImmediate(resolve))
        const results = await Promise.allSettled([...state.writers].map(sink => sink.flush()))
        state.failures = results.filter(row => row.status === 'rejected').length
        app.removeListener('will-quit', drain)
        app.quit()
      })()
    }
    app.on('will-quit', drain)
    quitDrains.set(app, state)
  }
  state.writers.add(writer)
  return state
}
exports.writerFor = function (file) {
  if (!writers.has(file)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Host-owned evidence sink.
    const fs = require('node:fs/promises')
    writers.set(
      file,
      exports.createEvidenceWriter((text) => fs.appendFile(file, text))
    )
  }
  return writers.get(file)
}
