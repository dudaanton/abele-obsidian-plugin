/** Test-only guard: direct plugin calls to blocking primitives fail independently of timing. */
export function scrollBlocking() {
  const calls: { operation: string; caller: string }[] = []
  const restores: (() => void)[] = []
  return {
    calls,
    wrap(object: Record<string, any>, operation: string, relevant = (_args: unknown[]) => true) {
      const original = object[operation]
      if (typeof original !== 'function') return
      function guarded(this: unknown, ...args: unknown[]) {
        // The immediate caller owns the operation, not an ancestor entry point.
        const caller = new Error().stack?.split('\n')[2] ?? ''
        if (relevant(args) && /plugin:abele(?:[/:)]|$)|\/plugins\/abele\/main\.js/.test(caller))
          calls.push({ operation, caller })
        return Reflect.apply(original, this, args)
      }
      object[operation] = guarded
      restores.push(() => {
        if (object[operation] === guarded) object[operation] = original
      })
    },
    install(requireModule: (name: string) => any) {
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
    },
    stop() {
      for (const restore of restores.reverse()) restore()
      restores.length = 0
    },
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
