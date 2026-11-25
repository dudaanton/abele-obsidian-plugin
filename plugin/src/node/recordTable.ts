/** Immutable record snapshots with path copying, not copies of the whole collection. */
interface Entry {
  key: string
  value: unknown
  order: number
}
interface Branch {
  item?: Entry
  children: Map<string, Branch>
}
const empty = (): Branch => ({ children: new Map() })
const tables = new WeakMap<object, RecordTable>()
export const DELETE_RECORD = Symbol('deleted record')
// Fixed fanout bounds the work at each copied path node, even for unrelated Unicode keys.
const digits = (key: string): string[] => {
  const result: string[] = []
  for (let i = 0; i < key.length; ++i)
    for (const shift of [12, 8, 4, 0]) result.push(String((key.charCodeAt(i) >> shift) & 15))
  return result
}

export function tableOf(value: object): RecordTable | undefined {
  return tables.get(value)
}

export class RecordTable {
  readonly view: Record<string, unknown>
  readonly previous?: WeakRef<RecordTable>
  private materialized?: Record<string, unknown>
  constructor(
    private readonly root: Branch = empty(),
    private readonly next = 0,
    previous?: RecordTable,
    readonly changedKeys: readonly string[] = []
  ) {
    this.previous = previous ? new WeakRef(previous) : undefined
    const target: Record<string, unknown> = {}
    const materialize = () => {
      if (!this.materialized) {
        const entries: [string, Entry][] = []
        const pending = [this.root]
        while (pending.length) {
          const branch = pending.pop()!
          if (branch.item) entries.push([branch.item.key, branch.item])
          for (const child of branch.children.values()) pending.push(child)
        }
        entries.sort((a, b) => a[1].order - b[1].order)
        for (const [key, item] of entries)
          Object.defineProperty(target, key, { value: item.value, enumerable: true })
        this.materialized = Object.freeze(target)
      }
      return this.materialized
    }
    this.view = new Proxy(target, {
      get: (_target, key) =>
        this.materialized
          ? Reflect.get(target, key)
          : typeof key === 'string' && this.has(key)
            ? this.get(key)
            : Reflect.get(Object.prototype, key),
      has: (_target, key) =>
        (typeof key === 'string' && this.has(key)) || Reflect.has(Object.prototype, key),
      ownKeys: () => Reflect.ownKeys(materialize()),
      getOwnPropertyDescriptor: (_target, key) => {
        if (this.materialized) return Reflect.getOwnPropertyDescriptor(target, key)
        return typeof key === 'string' && this.has(key)
          ? { value: this.get(key), enumerable: true, configurable: true, writable: false }
          : undefined
      },
      set: () => false,
      deleteProperty: () => false,
      setPrototypeOf: () => false,
      defineProperty: (_target, key, descriptor) =>
        this.materialized ? Reflect.defineProperty(target, key, descriptor) : false,
      isExtensible: () => {
        materialize()
        return false
      },
      preventExtensions: () => {
        materialize()
        return true
      },
    })
    tables.set(this.view, this)
  }
  private find(key: string): Entry | undefined {
    let branch = this.root
    for (const char of digits(key)) {
      branch = branch.children.get(char)
      if (!branch) return undefined
    }
    return branch.item
  }
  has(key: string): boolean {
    return !!this.find(key)
  }
  get(key: string): unknown {
    return this.find(key)?.value
  }
  patch(changes: Iterable<readonly [string, unknown]>): RecordTable {
    if (this.root.item || this.root.children.size) {
      let table: RecordTable | undefined
      for (const [key, value] of changes) {
        const current = table ?? this
        table = value === DELETE_RECORD ? current.delete(key) : current.set(key, value)
      }
      return table ?? this
    }
    // A cold import or a newly populated collection has no readers of its empty root.
    // Build that root once instead of copying every partially built path.
    const root = empty()
    let next = this.next
    let changed = false
    const changedKeys: string[] = []
    for (const [key, value] of changes) {
      changed = true
      changedKeys.push(key)
      let branch = root
      for (const char of digits(key)) {
        let child = branch.children.get(char)
        if (!child) {
          child = empty()
          branch.children.set(char, child)
        }
        branch = child
      }
      if (value === DELETE_RECORD) branch.item = undefined
      else branch.item = { key, value, order: branch.item?.order ?? next++ }
    }
    return changed ? new RecordTable(root, next, this, changedKeys) : this
  }
  set(key: string, value: unknown): RecordTable {
    const before = this.find(key)
    return this.update(
      key,
      { key, value, order: before?.order ?? this.next },
      before ? this.next : this.next + 1
    )
  }
  delete(key: string): RecordTable {
    return this.has(key) ? this.update(key, undefined, this.next) : this
  }
  private update(key: string, item: Entry | undefined, next: number): RecordTable {
    const chars = digits(key)
    const path = [this.root]
    for (const char of chars) path.push(path.at(-1)!.children.get(char) ?? empty())
    let child: Branch = { ...path.at(-1)!, item }
    for (let at = chars.length - 1; at >= 0; --at) {
      const branch = path[at],
        char = chars[at]
      const children = new Map(branch.children)
      if (!child.item && !child.children.size) children.delete(char)
      else children.set(char, child)
      child = { item: branch.item, children }
    }
    return new RecordTable(child, next, this, [key])
  }
  object(): Record<string, unknown> {
    // The proxy's frozen target is materialized only for explicit enumeration/cloning.
    if (!this.materialized) Object.isFrozen(this.view)
    return this.materialized!
  }
}
