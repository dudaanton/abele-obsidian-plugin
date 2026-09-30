/** A test-owned completion, with no wall-clock timeout or background work. */
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

/** Queue one-shot gates before starting an operation; await entered before changing its world. */
export class OperationDelays<K extends string> {
  private queues = new Map<K, Array<ReturnType<typeof this.gate>>>()

  private gate() {
    return { entered: deferred(), completion: deferred() }
  }

  holdNext(operation: K) {
    const gate = this.gate()
    const queue = this.queues.get(operation) ?? []
    queue.push(gate)
    this.queues.set(operation, queue)
    return {
      entered: gate.entered.promise,
      release: () => gate.completion.resolve(),
      reject: (error: unknown) => gate.completion.reject(error),
    }
  }

  take(operation: K): Promise<void> | undefined {
    const gate = this.queues.get(operation)?.shift()
    gate?.entered.resolve()
    return gate?.completion.promise
  }
}
