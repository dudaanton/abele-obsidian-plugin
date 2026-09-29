/** One removable disposal registry per plugin, not one retained plugin callback per script view. */
interface LifetimeOwner {
  register(stop: () => void): unknown
}
type OnDispose = (stop: () => void) => () => void
const owners = new WeakMap<LifetimeOwner, OnDispose>()

export function booksDisposalFor(owner: LifetimeOwner): OnDispose {
  const known = owners.get(owner)
  if (known) return known
  const pending = new Set<() => void>()
  let disposed = false
  const subscribe: OnDispose = (stop) => {
    if (disposed) {
      stop()
      return () => {}
    }
    pending.add(stop)
    return () => {
      pending.delete(stop)
    }
  }
  owners.set(owner, subscribe)
  owner.register(() => {
    disposed = true
    const stops = [...pending]
    pending.clear()
    for (const stop of stops) stop()
  })
  return subscribe
}
