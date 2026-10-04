/** Storage-independent routing of one resolved change batch to affected relation summaries. */
export interface RelationChange {
  kind: 'changed' | 'rename' | 'delete'
  path: string
  oldPath?: string
  /** Opaque storage identity, supplied by the adapter; paths may be reused. */
  identity?: unknown
}
interface Subscription {
  root: string
  day: string | null
  identity?: unknown
  paths: Set<string>
  apply: (changes: RelationChange[]) => void
}
export class RelationBatchRouter {
  private readonly subscriptions = new Set<Subscription>()
  private readonly initial = new Set<Subscription>()
  private readonly roots = new Map<string, Set<Subscription>>()
  private readonly paths = new Map<string, Set<Subscription>>()
  private readonly days = new Map<string, Set<Subscription>>()
  private add(map: Map<string, Set<Subscription>>, key: string, sub: Subscription) {
    let set = map.get(key)
    if (!set) map.set(key, (set = new Set()))
    set.add(sub)
  }
  private remove(map: Map<string, Set<Subscription>>, key: string, sub: Subscription) {
    const set = map.get(key)
    set?.delete(sub)
    if (!set?.size) map.delete(key)
  }
  private unbind(sub: Subscription) {
    this.remove(this.roots, sub.root, sub)
    for (const path of sub.paths) this.remove(this.paths, path, sub)
    if (sub.day) this.remove(this.days, sub.day, sub)
  }
  watchedPaths(): Iterable<string> {
    return this.paths.keys()
  }
  subscribe(apply: Subscription['apply']) {
    const sub: Subscription = { root: '', day: null, paths: new Set(), apply }
    this.subscriptions.add(sub)
    this.initial.add(sub)
    return {
      update: (root: string, day: string | null, paths: Iterable<string>, identity?: unknown) => {
        this.unbind(sub)
        sub.root = root
        sub.day = day
        sub.identity = identity
        sub.paths = new Set(paths)
        this.add(this.roots, root, sub)
        for (const path of sub.paths) this.add(this.paths, path, sub)
        if (day) this.add(this.days, day, sub)
      },
      stop: () => {
        this.unbind(sub)
        this.initial.delete(sub)
        this.subscriptions.delete(sub)
      },
    }
  }
  dispatch(
    changes: RelationChange[],
    ancestors: (path: string) => Set<string>,
    day: (path: string) => string | null,
    onError: (error: unknown) => void = () => {}
  ) {
    const batches = new Map<Subscription, RelationChange[]>()
    const roots = new Map<string, Set<Subscription>>()
    const paths = new Map<string, Set<Subscription>>()
    const reached = new Map<RelationChange, Set<Subscription>>()
    const empty = new Set<Subscription>()
    const lookup = (
      overlay: Map<string, Set<Subscription>>,
      original: Map<string, Set<Subscription>>,
      key: string
    ) => overlay.get(key) ?? original.get(key) ?? empty
    // Resolve ordered identity transitions first: metadata/ancestry supplied below describes
    // the final vault, even when its notification occupied an earlier position in the batch.
    for (const change of changes) {
      const source = change.kind === 'rename' ? (change.oldPath ?? change.path) : change.path
      const owners = lookup(paths, this.paths, source)
      const rootOwners = lookup(roots, this.roots, source)
      const matches = (sub: Subscription) =>
        !rootOwners.has(sub) ||
        change.identity === undefined ||
        sub.identity === undefined ||
        sub.identity === change.identity
      const affected = new Set([...owners].filter(matches))
      reached.set(change, affected)
      if (change.kind === 'changed') continue
      const movingRoots = new Set([...rootOwners].filter(matches))
      paths.set(source, new Set([...owners].filter((sub) => !affected.has(sub))))
      roots.set(source, new Set([...rootOwners].filter((sub) => !movingRoots.has(sub))))
      if (change.kind === 'rename') {
        paths.set(change.path, new Set([...lookup(paths, this.paths, change.path), ...affected]))
        roots.set(change.path, new Set([...lookup(roots, this.roots, change.path), ...movingRoots]))
      }
    }
    for (const sub of this.initial) batches.set(sub, [])
    this.initial.clear()
    for (const change of changes) {
      const affected = reached.get(change)!
      if (change.kind !== 'delete') {
        try {
          for (const target of ancestors(change.path))
            for (const sub of lookup(roots, this.roots, target)) affected.add(sub)
          const date = day(change.path)
          if (date) for (const sub of this.days.get(date) ?? []) affected.add(sub)
        } catch (error) {
          onError(error)
        }
      }
      for (const sub of affected) {
        let batch = batches.get(sub)
        if (!batch) batches.set(sub, (batch = []))
        batch.push(change)
      }
    }
    for (const [sub, batch] of batches)
      if (this.subscriptions.has(sub)) {
        try {
          sub.apply(batch)
        } catch (error) {
          onError(error)
        }
      }
  }
}
