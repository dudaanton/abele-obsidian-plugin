import { EngineError, type FileSystem, type ConditionalFileOperation } from '@abele/sync-sdk/core'

export const PRIVATE_REMOVAL_FILES = Symbol.for('abele.sync.private-removal-files-v1')
const prefix = '.abele-sync/retained-removals'
const privatePath = (path: string) => path === prefix || path.startsWith(prefix + '/')
/** A narrow local-only namespace, never part of server path admission. */
export function privateRemovalFileSystem(
  raw: FileSystem,
  root?: string,
  toLocal: (path: string) => string = (path) => path
): FileSystem {
  const mapped = (path: string) => {
    if (!privatePath(path)) return toLocal(path)
    const tail = path.slice(prefix.length)
    if (tail !== '' && tail !== '/summary.json' && !/^\/[a-f0-9-]{36}(?:\/victim)?$/.test(tail))
      throw new EngineError('protocol', 'Invalid retained removal path')
    return (root ?? '.abele-sync') + '/retained-removals' + tail
  }
  const pathMethods = new Set([
    'stat',
    'read',
    'readPrefix',
    'openRead',
    'fingerprint',
    'fileIdentity',
    'writeAtomic',
    'remove',
    'mkdir',
    'removeDirectory',
  ])
  const view = new Proxy(raw, {
    get(target, key) {
      if (key === PRIVATE_REMOVAL_FILES) return () => view
      if (key === Symbol.for('abele.sync.private-removal-view-v1')) return true
      const value = Reflect.get(target, key)
      if (typeof value !== 'function') return value
      if (pathMethods.has(String(key)))
        return (path: string, ...args: unknown[]) => value.call(target, mapped(path), ...args)
      if (key === 'conditionalFile')
        return (operation: ConditionalFileOperation) =>
          value.call(target, {
            ...operation,
            path: mapped(operation.path),
            effect:
              operation.effect.kind === 'move'
                ? { ...operation.effect, to: mapped(operation.effect.to) }
                : operation.effect.kind === 'remove' && operation.effect.retainAt !== undefined
                  ? { ...operation.effect, retainAt: mapped(operation.effect.retainAt) }
                  : operation.effect,
          })
      if (key === 'move')
        return (from: string, to: string, ...args: unknown[]) =>
          value.call(target, mapped(from), mapped(to), ...args)
      return value.bind(target)
    },
  })
  return view
}

/** Raw teardown cannot throw away the only durable owner of retained resources. */
export function assertDiscardableSyncLedger(metadata: ReadonlyMap<string, unknown>): void {
  for (const [key, value] of metadata) {
    if (
      value != null &&
      (key === 'plugin:pull-cleanup-head' ||
        key.startsWith('plugin:pull-cleanup:') ||
        key.startsWith('plugin:removal-decision:') ||
        key.startsWith('plugin:removal-source:'))
    )
      throw new Error('SDK cleanup must settle before ledger deletion')
  }
}
