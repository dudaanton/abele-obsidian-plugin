/** JSZip's task scheduler. Never replace the host's existing immediate APIs. */
type Callback = (...args: any[]) => void
type Task = { callback: Callback; args: any[] }

const host = window as unknown as {
  setImmediate?: (callback: Callback, ...args: any[]) => number
  clearImmediate?: (handle: number) => void
}

// A host-provided setImmediate owns its handles; do not try to supply a canceller for them.
if (typeof host.setImmediate !== 'function') {
  let nextHandle = 1
  const tasks = new Map<number, Task>()
  host.setImmediate = (callback, ...args) => {
    if (typeof callback !== 'function') throw new TypeError('Callback must be a function')
    const handle = nextHandle++
    tasks.set(handle, { callback, args })
    // A task, not a microtask: async ZIP streams must yield to rendering and timers.
    window.setTimeout(() => {
      const task = tasks.get(handle)
      tasks.delete(handle)
      if (task) {
        const { callback, args } = task
        callback(...args)
      }
    }, 0)
    return handle
  }
  if (typeof host.clearImmediate !== 'function') {
    host.clearImmediate = (handle) => {
      tasks.delete(handle)
    }
  }
}

export {}
