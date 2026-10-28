/** Copy-on-write JSON data. Reading an untouched branch allocates no payload copy. */
const drafts = new WeakMap<object, { finish: () => unknown }>()

export function frozen<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value)))
      if ('value' in descriptor) frozen(descriptor.value)
    Object.freeze(value)
  }
  return value
}

/** Detach callback results and assigned objects from transaction proxies and caller ownership. */
export function plain<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  const draft = drafts.get(value)
  if (draft) return draft.finish() as T
  if (Object.isFrozen(value)) return value
  if (Array.isArray(value)) return value.map(plain) as T
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plain(child)])) as T
}

export function storeDraft<T extends object>(base: T, parentChanged: () => void = () => {}) {
  let copy: T | undefined
  const children = new Map<PropertyKey, ReturnType<typeof storeDraft>>()
  const mark = () => {
    if (copy) return
    copy = (Array.isArray(base) ? base.slice() : { ...base }) as T
    parentChanged()
  }
  const source = () => copy ?? base
  const value: T = new Proxy((Array.isArray(base) ? [] : {}) as T, {
    get(_target, key) {
      const item = Reflect.get(source(), key)
      if (!item || typeof item !== 'object') return item
      let child = children.get(key)
      if (!child) {
        child = storeDraft(item, mark)
        children.set(key, child)
      }
      return child.value
    },
    set(_target, key, next) {
      if (Object.is(Reflect.get(source(), key), next)) return true
      mark()
      children.delete(key)
      Reflect.set(copy!, key, next)
      return true
    },
    deleteProperty(_target, key) {
      if (!Object.hasOwn(source(), key)) return true
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
  return { value, finish, changed: () => copy !== undefined }
}
