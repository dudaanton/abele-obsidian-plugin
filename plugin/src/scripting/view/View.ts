/**
 * What `view()` hands a script: the tab it is about to open, as an object.
 *
 * The script sets `body`, attaches hooks, and calls `open()`. The run then ends, and this
 * object is what keeps living — its handlers are called by the renderer, its `state` is
 * written into the workspace layout, and `dispose()` is what the host calls when the tab goes.
 *
 * The host is an interface so this can be exercised without a workspace. `run()` is the one
 * door every handler goes through: a throw is reported into `errors` (the strip at the top
 * of the view) and the console, and the view keeps working.
 */
import { markRaw, reactive } from 'vue'
import type { Handler, ViewNode } from './components'

export type Placement = 'tab' | 'split' | 'sidebar' | 'window'
export type ViewEvent = 'close' | 'focus' | 'blur' | 'key' | 'vault' | 'resize'

export interface VaultChange {
  type: 'create' | 'modify' | 'delete' | 'rename'
  path: string
  oldPath?: string
}

export interface ViewOptions {
  title: string
  icon?: string
}

/** The leaf waiting for this view, and the state it saved, when a tab is being rebuilt. */
export interface RestoreInfo {
  leafId: string
  state: Record<string, unknown>
}

/** Which script made the view and with what — what the leaf saves so it can run it again. */
export interface ViewOrigin {
  script: string
  params: Record<string, unknown>
}

export interface OpenOptions {
  where?: Placement
  active?: boolean
}

/** How many messages the error strip keeps before the oldest fall off. */
const MAX_ERRORS = 20

export interface ViewHost {
  open(view: View, opts: Required<OpenOptions>): Promise<void>
  close(view: View): void
}

export class View {
  title: string
  icon: string
  body: ViewNode | ViewNode[] = []
  state: Record<string, unknown>
  css: string[] = []
  errors: string[] = []
  leafId: string | null = null
  readonly origin: ViewOrigin
  readonly restore?: RestoreInfo

  private readonly host: ViewHost
  private readonly controller = markRaw(new AbortController())
  private readonly hooks: Record<string, Handler[]> = {}
  // `number`, not `ReturnType<typeof window.setInterval>`: with @types/node in scope that alias
  // resolves to Node's `Timeout`, while the DOM call this makes returns a plain handle.
  private timers: number[] = []
  private opened = false
  private disposed = false

  constructor(opts: ViewOptions, host: ViewHost, origin: ViewOrigin, restore?: RestoreInfo) {
    this.title = opts.title
    this.icon = opts.icon ?? 'scroll-text'
    this.host = markRaw(host)
    this.origin = origin
    this.restore = restore
    this.state = restore?.state ?? {}
    return reactive(this) as this
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  get isOpen(): boolean {
    return this.leafId !== null
  }

  get nodes(): ViewNode[] {
    return Array.isArray(this.body) ? this.body : [this.body]
  }

  style(css: string): this {
    this.css.push(css)
    return this
  }

  on(event: ViewEvent, fn: Handler): this {
    ;(this.hooks[event] ??= []).push(fn)
    return this
  }

  /**
   * Calls the hooks for `event`, each through `run`, so one bad hook does not stop the rest.
   *
   * A closed view is deaf. The leaf is gone and its state is no longer saved, so a vault change
   * or a stray keystroke arriving late must not reach a script that believes it has finished —
   * only `dispose` gets its `close` through, by way of `fire`.
   */
  async emit(event: ViewEvent, payload?: unknown): Promise<void> {
    if (this.disposed) return
    await this.fire(event, payload)
  }

  private async fire(event: ViewEvent, payload?: unknown): Promise<void> {
    for (const fn of this.hooks[event] ?? []) await this.run(() => fn(payload))
  }

  every(ms: number, fn: () => unknown): () => void {
    // A view that has closed takes no new work; the canceller is still returned so that a
    // script holding one does not have to know which side of `dispose` it is on.
    if (this.disposed) return () => {}
    const id = window.setInterval((): void => void this.run(fn), ms)
    this.timers.push(id)
    return () => {
      window.clearInterval(id)
      this.timers = this.timers.filter((t) => t !== id)
    }
  }

  find(id: string): ViewNode | undefined {
    for (const node of this.nodes) {
      if (node.id === id) return node
      const deep = node.find(id)
      if (deep) return deep
    }
    return undefined
  }

  async open(opts: OpenOptions = {}): Promise<void> {
    if (this.opened) throw new Error('This view is already open')
    this.opened = true
    await this.host.open(this, { where: opts.where ?? 'tab', active: opts.active ?? true })
  }

  close(): void {
    this.host.close(this)
  }

  /** The host's call when the leaf is gone. Idempotent. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const t of this.timers) window.clearInterval(t)
    this.timers = []
    this.controller.abort()
    await this.fire('close')
    this.leafId = null
  }

  /**
   * Shows an error in the view's strip and writes it to the console.
   *
   * A handler on a timer can throw every tick, so the strip keeps the last {@link MAX_ERRORS}
   * and repeats of the message already at the bottom are folded away: thirty failures of one
   * `every(10, …)` are one line, not a list nobody can read past. The console still gets each.
   */
  report(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    if (this.errors[this.errors.length - 1] !== message) {
      this.errors.push(message)
      if (this.errors.length > MAX_ERRORS) this.errors.splice(0, this.errors.length - MAX_ERRORS)
    }
    console.error(`[Abele view ${this.title}]`, err)
  }

  dismissErrors(): void {
    this.errors.splice(0)
  }

  /** Every handler goes through here. Returns what the handler returned, or nothing on a throw. */
  async run<T>(fn: () => T | Promise<T>): Promise<T | undefined> {
    try {
      return await fn()
    } catch (err) {
      this.report(err)
      return undefined
    }
  }
}
