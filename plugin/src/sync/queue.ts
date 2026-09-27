export const noop = (): void => undefined

/**
 * Everything that touches the engine goes through one of these, in the order it was asked for.
 *
 * `init`, a settings save, `chooseVault` and `disconnect` can all arrive while the previous
 * one is still opening a database or stopping an engine, and two of them interleaved would
 * leave a store closed under a running engine.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve()

  /** Runs the work after everything asked for before it, whether that succeeded or not. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn)
    this.tail = next.then(noop, noop)
    return next
  }
}
