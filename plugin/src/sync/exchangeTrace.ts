/** Device-local diagnostics only. Labels must never contain tokens, headers or request bodies. */
export class ExchangeTrace {
  private readonly active = new Map<symbol, { operation: string; startedAt: number }>()
  private readonly lines: string[] = []
  private sealed = false
  private total = 0
  private readonly stages = new Map<
    string,
    { stage: string; startedAt: number; durationMs: number; completed: number }
  >()
  inventory(total: number): void {
    if (!this.sealed) this.total = Math.max(this.total, total)
  }
  finishFirstSync(): void {
    this.sealed = true
  }
  private readonly scans: {
    operation: string
    startedAt: number
    durationMs: number
    completed: number
  }[] = []
  begin(operation: string): (completed?: number) => void {
    const id = Symbol()
    const startedAt = Date.now()
    const stage =
      operation === 'fs list'
        ? 'scan'
        : operation.startsWith('fs read ')
          ? 'compare'
          : /^(GET|POST|PUT|DELETE|HEAD) /.test(operation)
            ? 'transfer'
            : null
    const timing =
      !this.sealed && stage
        ? (this.stages.get(stage) ?? { stage, startedAt, durationMs: 0, completed: 0 })
        : null
    if (timing) this.stages.set(timing.stage, timing)
    this.active.set(id, { operation, startedAt })
    return (completed = 0) => {
      this.active.delete(id)
      if (timing) {
        timing.durationMs += Date.now() - startedAt
        timing.completed += stage === 'scan' ? completed : 1
        if (stage !== 'compare' || timing.completed <= 8 || timing.completed % 128 === 0)
          console.debug('[Abele Sync first exchange]', { ...timing, total: this.total })
      }
      if (operation === 'fs list') {
        const timing = { operation, startedAt, durationMs: Date.now() - startedAt, completed }
        this.scans.push(timing)
        if (this.scans.length > 32) this.scans.shift()
        console.debug('[Abele Sync scan]', timing)
      }
    }
  }
  async run<T>(operation: string, work: () => Promise<T>): Promise<T> {
    const finish = this.begin(operation)
    try {
      return await work()
    } finally {
      finish()
    }
  }
  log(line: string): void {
    this.lines.push(line)
    if (this.lines.length > 32) this.lines.shift()
  }
  snapshot() {
    return {
      active: [...this.active.values()].map((one) => ({
        operation: one.operation,
        elapsedMs: Date.now() - one.startedAt,
      })),
      log: [...this.lines],
      scans: this.scans.map((one) => ({ ...one })),
      firstSync: {
        complete: this.sealed,
        total: this.total,
        stages: [...this.stages.values()].map((one) => ({ ...one })),
      },
    }
  }
}
