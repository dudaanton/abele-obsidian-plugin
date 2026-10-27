/** One small, monotonic timeline per plugin load. It keeps no paths or request details. */
export type SyncStartupPhase =
  | 'onload'
  | 'layout-ready'
  | 'db-open'
  | 'engine-construct'
  | 'first-request'
  | 'first-response'
  | 'reconcile-start'
  | `connection:${string}:${'begin' | 'end'}`
  | `reconcile:${string}:${'begin' | 'end'}`
  | 'idle'

export interface SyncStartupMark {
  phase: SyncStartupPhase
  elapsedMs: number
  at: number
}

export class SyncStartupTimeline {
  private origin?: number
  private readonly marks = new Map<SyncStartupPhase, SyncStartupMark>()
  private readonly listeners = new Set<(mark: SyncStartupMark) => void>()

  constructor(
    private readonly monotonic = () => performance.now(),
    private readonly wall = () => Date.now()
  ) {}

  mark(phase: SyncStartupPhase): void {
    if (this.marks.has(phase)) return
    const now = this.monotonic()
    this.origin ??= now
    const mark = { phase, elapsedMs: Math.round(now - this.origin), at: this.wall() }
    this.marks.set(phase, mark)
    for (const listener of this.listeners) this.deliver(listener, mark)
  }

  async stage<T>(
    area: 'connection' | 'reconcile',
    name: string,
    work: () => Promise<T>
  ): Promise<T> {
    this.mark(`${area}:${name}:begin`)
    try {
      return await work()
    } finally {
      this.mark(`${area}:${name}:end`)
    }
  }

  subscribe(listener: (mark: SyncStartupMark) => void): () => void {
    for (const mark of this.marks.values()) this.deliver(listener, mark)
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private deliver(listener: (mark: SyncStartupMark) => void, mark: SyncStartupMark): void {
    try {
      listener(mark)
    } catch (error) {
      console.debug('[Abele Sync] startup activity unavailable', error)
    }
  }
}

/** Observe the actual transport boundary, including requests made before engine construction. */
export function timedSyncTransport(
  transport: typeof fetch,
  timeline: SyncStartupTimeline
): typeof fetch {
  return async (input, init) => {
    timeline.mark('first-request')
    const response = await transport(input, init)
    timeline.mark('first-response')
    return response
  }
}
