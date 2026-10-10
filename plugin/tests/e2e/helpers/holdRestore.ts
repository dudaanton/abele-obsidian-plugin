/** Delay one restore without referring to mutable window globals after it resumes. */
export function holdRestore<T extends (...args: never[]) => Promise<unknown>>(client: {
  restoreDeleted: T
}) {
  const original = client.restoreDeleted
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  client.restoreDeleted = (async (...args: Parameters<T>) => {
    await waiting
    return original.apply(client, args)
  }) as T
  return () => {
    client.restoreDeleted = original
    release()
  }
}
