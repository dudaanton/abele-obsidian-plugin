/** Device-local diagnostics only. Labels must never contain tokens, headers or request bodies. */
export class ExchangeTrace {
  private readonly active = new Map<symbol, { operation: string; startedAt: number }>()
  private readonly lines: string[] = []
  begin(operation: string): () => void {
    const id = Symbol()
    this.active.set(id, { operation, startedAt: Date.now() })
    return () => {
      this.active.delete(id)
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
    }
  }
}
