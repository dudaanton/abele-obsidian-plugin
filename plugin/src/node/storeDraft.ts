/** Copy-on-write JSON data. Reading an untouched branch allocates no payload copy. */
import { DELETE_RECORD, RecordTable, tableOf } from './recordTable'
const drafts = new WeakMap<object, { finish: () => unknown; snapshot?: () => unknown }>()

/** Compare validated JSON projections without serializing their potentially large output. */
export function sameStoredValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every(
    (key) =>
      Object.hasOwn(right, key) && sameStoredValue(Reflect.get(left, key), Reflect.get(right, key))
  )
}

export function frozen<T>(value: T): T {
  if (value && typeof value === 'object' && tableOf(value)) return value
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value)))
      if ('value' in descriptor) frozen(descriptor.value)
    Object.freeze(value)
  }
  return value
}

/** Resolve a draft revision without cloning ordinary mutable callers (which stay uncached). */
export function snapshotOf<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  const draft = drafts.get(value)
  return ((draft?.snapshot ?? draft?.finish)?.() ?? value) as T
}

/** Detach callback results and assigned objects from transaction proxies and caller ownership. */
export function plain<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  const draft = drafts.get(value)
  if (draft) return draft.finish() as T
  const table = tableOf(value)
  if (table) return table.object() as T
  if (Object.isFrozen(value)) return value
  if (Array.isArray(value)) return value.map(plain) as T
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plain(child)])) as T
}

interface StoreDraft<T extends object> {
  value: T
  finish: () => T
  snapshot: () => T
  changed: () => boolean
  revision: () => number
  editedKeys: () => Set<PropertyKey>
}

function recordDraft<T extends object>(
  table: RecordTable,
  parentChanged: () => void
): StoreDraft<T> {
  const edits = new Map<string, unknown>()
  const deleted = new Set<string>()
  const children = new Map<string, StoreDraft<object>>()
  const keys = new Set<PropertyKey>()
  let revision = 0
  let savedRevision = -1
  let saved = table
  const mark = (key: string) => {
    keys.add(key)
    ++revision
    parentChanged()
  }
  const get = (key: string) =>
    deleted.has(key) ? undefined : edits.has(key) ? edits.get(key) : table.get(key)
  const has = (key: string) => !deleted.has(key) && (edits.has(key) || table.has(key))
  const snapshot = (): T => {
    if (savedRevision === revision) return saved.view as T
    saved = table.patch(
      [...(keys as Set<string>)].map(
        (key) =>
          [
            key,
            deleted.has(key)
              ? DELETE_RECORD
              : frozen(children.get(key)?.finish() ?? plain(get(key))),
          ] as const
      )
    )
    savedRevision = revision
    return saved.view as T
  }
  const value: T = new Proxy({} as T, {
    get: (_target, key) => {
      if (typeof key !== 'string') return Reflect.get(table.view, key)
      const item = get(key)
      if (!item || typeof item !== 'object')
        return has(key) ? item : Reflect.get(Object.prototype, key)
      let child = children.get(key)
      if (!child) {
        child = storeDraft(item, () => mark(key))
        children.set(key, child)
      }
      return child.value
    },
    set: (_target, key, next) => {
      if (typeof key !== 'string') throw new TypeError('Record keys must be strings')
      if (has(key) && Object.is(get(key), next)) return true
      mark(key)
      deleted.delete(key)
      edits.set(key, next)
      children.delete(key)
      return true
    },
    deleteProperty: (_target, key) => {
      if (typeof key !== 'string' || !has(key)) return true
      mark(key)
      deleted.add(key)
      edits.delete(key)
      children.delete(key)
      return true
    },
    ownKeys: () => Reflect.ownKeys(snapshot()),
    has: (_target, key) =>
      (typeof key === 'string' && has(key)) || Reflect.has(Object.prototype, key),
    getOwnPropertyDescriptor: (_target, key) =>
      typeof key === 'string' && has(key)
        ? { value: Reflect.get(value, key), enumerable: true, configurable: true, writable: true }
        : undefined,
  })
  const finish = () => tableOf(snapshot())!.object() as T
  drafts.set(value, { finish, snapshot })
  return {
    value,
    finish,
    snapshot,
    changed: () => revision > 0,
    revision: () => revision,
    editedKeys: () => keys,
  }
}

export function storeDraft<T extends object>(
  base: T,
  parentChanged: () => void = () => {}
): StoreDraft<T> {
  const table = tableOf(base)
  if (table) return recordDraft(table, parentChanged)
  let copy: T | undefined
  let revision = 0
  const editedKeys = new Set<PropertyKey>()
  const children = new Map<PropertyKey, ReturnType<typeof storeDraft>>()
  const mark = () => {
    ++revision
    if (!copy) copy = (Array.isArray(base) ? base.slice() : { ...base }) as T
    parentChanged()
  }
  const source = () => copy ?? base
  const value: T = new Proxy((Array.isArray(base) ? [] : {}) as T, {
    get(_target, key) {
      const item = Reflect.get(source(), key)
      if (!item || typeof item !== 'object') return item
      let child = children.get(key)
      if (!child) {
        child = storeDraft(item, () => {
          editedKeys.add(key)
          mark()
        })
        children.set(key, child)
      }
      return child.value
    },
    set(_target, key, next) {
      if (Object.is(Reflect.get(source(), key), next)) return true
      editedKeys.add(key)
      mark()
      children.delete(key)
      Reflect.set(copy!, key, next)
      return true
    },
    deleteProperty(_target, key) {
      if (!Object.hasOwn(source(), key)) return true
      editedKeys.add(key)
      mark()
      children.delete(key)
      return Reflect.deleteProperty(copy!, key)
    },
    ownKeys: () => Reflect.ownKeys(source()),
    has: (_target, key) => Reflect.has(source(), key),
    getOwnPropertyDescriptor(_target, key): PropertyDescriptor | undefined {
      if (Array.isArray(base) && key === 'length')
        return {
          value: Reflect.get(source(), 'length'),
          writable: true,
          enumerable: false,
          configurable: false,
        }
      const descriptor = Reflect.getOwnPropertyDescriptor(source(), key)
      return descriptor
        ? {
            value: Reflect.get(value, key),
            enumerable: descriptor.enumerable,
            writable: true,
            configurable: true,
          }
        : undefined
    },
  })
  const finish = (): T => {
    if (!copy) return Object.isFrozen(base) ? base : frozen(plain(base))
    const result = (Array.isArray(copy) ? copy.slice() : { ...copy }) as T
    for (const key of Reflect.ownKeys(result)) {
      if (key === 'length' && Array.isArray(result)) continue
      Reflect.set(result, key, children.get(key)?.finish() ?? plain(Reflect.get(result, key)))
    }
    return frozen(result)
  }
  drafts.set(value, { finish })
  return {
    value,
    finish,
    snapshot: finish,
    changed: () => copy !== undefined,
    revision: () => revision,
    editedKeys: () => editedKeys,
  }
}
