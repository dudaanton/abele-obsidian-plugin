/** An ordinary array after its first observation; importing a catalogue does not parse it. */
export function lazyArray<T>(create: () => T[]): T[] {
  const target: T[] = []
  let initialized = false
  const ensure = () => {
    if (initialized) return
    const values = create()
    for (const value of values) target.push(value)
    initialized = true
  }
  return new Proxy(target, {
    get(array, key, receiver) {
      ensure()
      return Reflect.get(array, key, receiver)
    },
    set(array, key, value, receiver) {
      ensure()
      return Reflect.set(array, key, value, receiver)
    },
    has(array, key) {
      ensure()
      return Reflect.has(array, key)
    },
    ownKeys(array) {
      ensure()
      return Reflect.ownKeys(array)
    },
    getOwnPropertyDescriptor(array, key) {
      ensure()
      return Reflect.getOwnPropertyDescriptor(array, key)
    },
    defineProperty(array, key, descriptor) {
      ensure()
      return Reflect.defineProperty(array, key, descriptor)
    },
    deleteProperty(array, key) {
      ensure()
      return Reflect.deleteProperty(array, key)
    },
    preventExtensions(array) {
      ensure()
      return Reflect.preventExtensions(array)
    },
  })
}
