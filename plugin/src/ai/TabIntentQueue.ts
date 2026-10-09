/** A user action's presentation claim, not a file-ownership or storage generation. */
export interface TabIntent {
  readonly target: string
  readonly contextual: boolean
  readonly current?: () => boolean
}

/** Mutable binding is private to the queue; its priority is the original action's order. */
interface AdmittedTabIntent extends TabIntent {
  target: string
  readonly order: number
}

/**
 * One synchronous commit queue for tab state. Slow preparation runs outside it; its result
 * may commit only under the original intent. A synchronous observer can enqueue another
 * action, but its mutation runs after the enclosing transaction, never halfway through it.
 */
export class TabIntentQueue {
  private pending: (() => void)[] = []
  private draining = false
  private latest = new Map<string, AdmittedTabIntent>()
  private foreground?: TabIntent
  private order = 0

  /** Reentrant callers enqueue work and receive no immediate result. Internal helpers stay inline. */
  mutate<T>(work: () => T): T | undefined {
    let result: T | undefined
    this.pending.push(() => {
      result = work()
    })
    if (this.draining) return undefined
    this.draining = true
    let failed = false
    let error: unknown
    try {
      while (this.pending.length) {
        try {
          this.pending.shift()!()
        } catch (caught) {
          if (!failed) error = caught
          failed = true
        }
      }
    } finally {
      this.draining = false
    }
    if (failed) throw error
    return result
  }

  /** Permission/resource factories must return their result now, or refuse before enqueueing. */
  mutateImmediate<T>(work: () => T): T {
    if (this.draining) throw new Error('A synchronous reservation cannot run inside a presentation transaction.')
    return this.mutate(work) as T
  }

  /** Capture a reveal continuation's authority without admitting another user action. */
  captureForeground(): TabIntent | undefined { return this.foreground }

  /** Admission is synchronous so a new action supersedes even a commit queued by an observer. */
  begin(target: string, contextual: boolean, current?: () => boolean): TabIntent {
    const intent = { target, contextual, current, order: ++this.order }
    if (!current || current()) {
      this.latest.set(target, intent)
      this.foreground = intent
    }
    return intent
  }

  /**
   * Bind a provisional request to its resolved conversation. This is admission bookkeeping,
   * not a new action: preserve foreground and priority, even when resolution finishes late.
   */
  retarget(intent: TabIntent, target: string): boolean {
    const admitted = this.latest.get(intent.target)
    if (admitted !== intent || !this.valid(intent)) return false
    if (intent.target === target) return true
    this.latest.delete(intent.target)
    const incumbent = this.latest.get(target)
    admitted.target = target
    if (!incumbent || incumbent.order < admitted.order) this.latest.set(target, admitted)
    return this.valid(intent)
  }

  valid(intent: TabIntent): boolean {
    return (
      this.latest.get(intent.target) === intent &&
      (!intent.current || intent.current()) &&
      (!intent.contextual || this.foreground === intent)
    )
  }

  selected(intent: TabIntent): boolean {
    return this.valid(intent) && this.foreground === intent
  }

  apply<T>(intent: TabIntent, work: () => T): T | undefined {
    return this.mutate(() => (this.valid(intent) ? work() : undefined))
  }

  /** Async callers await the queued result, not I/O inside the queue or a reentrant fallback. */
  applyAsync<T>(intent: TabIntent, work: () => T): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.mutate(() => {
        try {
          resolve(this.valid(intent) ? work() : undefined)
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Tab presentation failed', { cause: error }))
        }
      })
    })
  }

  clear(): void {
    this.latest.clear()
    this.foreground = undefined
    // Keep queued callbacks so async callers settle; their intent checks now reject them.
  }
}
