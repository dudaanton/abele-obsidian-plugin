/** Test builds only: the desktop layout stand supplies its real native transport before startup. */
export function syncTransportForTests(): typeof fetch | undefined {
  const value: unknown = Reflect.get(window, Symbol.for('abele.sync.test-transport-v1'))
  return typeof value === 'function' ? (value as typeof fetch) : undefined
}
