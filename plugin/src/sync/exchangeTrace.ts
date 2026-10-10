/** Device-local diagnostics only. Labels must never contain tokens, headers or request bodies. */
export class ExchangeTrace {
  private readonly active = new Map<symbol, { operation: string; startedAt: number }>()
  private readonly lines: string[] = []
  private readonly scans: {
    operation: string
    startedAt: number
    durationMs: number
    completed: number
  }[] = []
  begin(operation: string): (completed?: number) => void {
    const id = Symbol()
    const startedAt = Date.now()
    this.active.set(id, { operation, startedAt })
    return (completed = 0) => {
      this.active.delete(id)
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
    }
  }
}
