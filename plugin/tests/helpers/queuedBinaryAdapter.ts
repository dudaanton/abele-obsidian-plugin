import type { DataAdapter } from 'obsidian'

/** Model the native queue used by binary revision checks without changing other fixtures. */
export function queueBinaryAdapter(adapter: DataAdapter): void {
  type Queued = DataAdapter & { queue<T>(action: () => Promise<T>): Promise<T> }
  const host = adapter as Queued
  let tail: Promise<unknown> = Promise.resolve()
  host.queue = <T>(action: () => Promise<T>): Promise<T> => {
    const result = tail.then(action, action)
    tail = result.then(
      () => {},
      () => {}
    )
    return result
  }
  for (const name of ['stat', 'readBinary', 'writeBinary']) {
    const raw = Reflect.get(host, name)
    Reflect.set(host, name, function (this: Queued, ...args: unknown[]) {
      return this.queue(() => raw.apply(host, args))
    })
  }
}
