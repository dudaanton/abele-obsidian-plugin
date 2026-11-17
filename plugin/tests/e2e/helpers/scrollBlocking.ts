/** Test-only guard: direct plugin calls to blocking primitives fail independently of timing. */
export function scrollBlocking() {
  const calls: { operation: string; caller: string }[] = []
  const restores: (() => void)[] = []
  const cleanupErrors: string[] = []
  let inspecting = false
  let enabled = true
  const registry = globalThis as typeof globalThis & {
    __abeleScrollGuards?: Set<{ stop(): void }>
    __abeleScrollGuardErrors?: string[]
  }
  return {
    calls,
    cleanupErrors,
    wrap(object: Record<string, any>, operation: string, relevant = (_args: unknown[]) => true) {
      const original = object[operation]
      if (typeof original !== 'function') return
      enabled = true
      const descriptor = Object.getOwnPropertyDescriptor(object, operation)
      // A callable proxy preserves native/custom properties and constructor behavior.
      const guarded = new Proxy(original, {
        apply(target, receiver, args) {
          if (enabled && !inspecting) {
            inspecting = true
            const prepare = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace')
            try {
              // Do not invoke the host's stack formatter: it can perform sync
              // file/IPC work. Read only the immediate V8 call site's identity.
              Object.defineProperty(Error, 'prepareStackTrace', {
                configurable: true,
                writable: true,
                value: (_error: Error, frames: NodeJS.CallSite[]) =>
                  frames[1]?.getScriptNameOrSourceURL() ?? frames[1]?.getFileName() ?? '',
              })
              const caller = new Error().stack ?? ''
              if (
                relevant(args) &&
                /plugin:abele(?:[/:)]|$)|\/plugins\/abele\/main\.js/.test(caller)
              )
                calls.push({ operation, caller })
            } finally {
              try {
                if (prepare) Object.defineProperty(Error, 'prepareStackTrace', prepare)
                else delete Error.prepareStackTrace
              } finally {
                inspecting = false
              }
            }
          }
          return Reflect.apply(target, receiver, args)
        },
      })
      Object.defineProperty(object, operation, {
        configurable: descriptor?.configurable ?? true,
        enumerable: descriptor?.enumerable ?? true,
        writable: true,
        value: guarded,
      })
      restores.push(() => {
        if (descriptor) Object.defineProperty(object, operation, descriptor)
        else delete object[operation]
      })
    },
    install(requireModule: (name: string) => any) {
      ;(registry.__abeleScrollGuards ??= new Set()).add(this)
      try {
        const fs = requireModule('node:fs')
        for (const key of Object.keys(fs)) if (key.endsWith('Sync')) this.wrap(fs, key)
        const child = requireModule('node:child_process')
        for (const key of ['spawnSync', 'execSync', 'execFileSync']) this.wrap(child, key)
        this.wrap(Atomics, 'wait')
        for (const key of ['alert', 'confirm', 'prompt']) this.wrap(globalThis, key)
        if (typeof XMLHttpRequest !== 'undefined')
          this.wrap(XMLHttpRequest.prototype, 'open', (args) => args[2] === false)
        const ipc = requireModule('electron').ipcRenderer
        if (ipc) this.wrap(ipc, 'sendSync')
      } catch (error) {
        this.stop()
        throw error
      }
    },
    stop() {
      enabled = false
      for (const restore of restores.reverse()) {
        try {
          restore()
        } catch (error) {
          cleanupErrors.push(String(error))
          ;(registry.__abeleScrollGuardErrors ??= []).push(String(error))
        }
      }
      restores.length = 0
      registry.__abeleScrollGuards?.delete(this)
    },
  }
}

/** Independent after-case cleanup, including when the probe exits before its own finally. */
export function stopScrollGuards() {
  const registry = globalThis as typeof globalThis & {
    __abeleScrollGuards?: Set<{ stop(): void }>
    __abeleScrollGuardErrors?: string[]
  }
  for (const guard of registry.__abeleScrollGuards ?? []) {
    guard.stop()
  }
  return registry.__abeleScrollGuardErrors?.splice(0) ?? []
}

/** Fixed in-process injection: no child process, IPC, sleeping worker, or unbounded native wait. */
export function boundedScrollStall() {
  const end = performance.now() + 250
  while (performance.now() < end) {
    /* deliberate synchronous scroll regression */
  }
}

/** Count nominal CPU samples in our executing code, excluding nested host frames and
 * descheduling gaps. The profile clock and long-task clock share NavigationStart. */
export function ownScrollTaskCpu(
  profile: {
    startTime: number
    nodes: { id: number; callFrame: { url: string }; children?: number[] }[]
    samples?: number[]
    timeDeltas?: number[]
  },
  tasks: { start: number; duration: number }[],
  navigationStart: number,
  intervalMs = 0.5
) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const parents = new Map<number, number>()
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id)
  const totals = tasks.map(() => 0)
  let at = profile.startTime / 1000 - navigationStart * 1000
  for (const [index, id] of (profile.samples ?? []).entries()) {
    at += (profile.timeDeltas?.[index] ?? 0) / 1000
    let node = nodes.get(id)
    // Native/VM frames inherit their nearest script caller. A host script below
    // a plugin entry point remains host work, and a plugin listener below a host is ours.
    while (node && (!node.callFrame.url || node.callFrame.url.startsWith('node:')))
      node = nodes.get(parents.get(node.id)!)
    if (!node || !/^plugin:abele(?:[/:]|$)|\/plugins\/abele\/main\.js/.test(node.callFrame.url))
      continue
    for (let t = 0; t < tasks.length; t++)
      if (at >= tasks[t].start && at <= tasks[t].start + tasks[t].duration) totals[t] += intervalMs
  }
  return Math.max(0, ...totals)
}
