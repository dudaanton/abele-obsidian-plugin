import { EngineError, type FileSystem, type AtomicStage } from '@abele/sync-core'
import { PLACEMENT } from './pathCoordinator'
import { privatePlacementStages, PRIVATE_PLACEMENT_STAGES } from './privatePlacementStages'
import { IGNORE_FILE } from './scope'

export class FolderScopeError extends EngineError {
  constructor(message: string) {
    super('protocol', message)
  }
}

/** A missed incoming validation must never turn into access to another local folder. */
export function scopedFileSystem(
  fs: FileSystem,
  assertPath: (path: string) => void,
  includes: (path: string) => boolean,
  privateRoot?: string
): FileSystem {
  const handles = new Set<string>()
  const stages = privatePlacementStages(fs, privateRoot)
  const retained = (stage: AtomicStage): AtomicStage => {
    handles.add(stage.id)
    return new Proxy(stage, {
      get(target, key) {
        const value = Reflect.get(target, key)
        if (key === 'commit' || key === 'discard')
          return async (...args: unknown[]) => {
            const result = await value.apply(target, args)
            handles.delete(target.id)
            return result
          }
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
  return new Proxy(fs, {
    get(target, key) {
      if (key === PRIVATE_PLACEMENT_STAGES) return stages
      const value = Reflect.get(target, key)
      if (typeof value !== 'function') return value
      if (key === 'list' || key === 'listDirectories')
        return async function* () {
          for await (const info of value.call(target)) {
            if (!includes(info.path)) continue
            assertPath(info.path)
            yield info
          }
        }
      if (key === 'watch')
        return (notify: (paths: string[]) => void) =>
          value.call(target, (paths: string[]) =>
            notify(paths.filter((path) => path === IGNORE_FILE || includes(path)))
          )
      if (key === PLACEMENT)
        return (paths: string[], work: () => Promise<unknown>, preserve?: boolean | string[]) => {
          paths.forEach(assertPath)
          if (Array.isArray(preserve)) preserve.forEach(assertPath)
          return value.call(target, paths, work, preserve)
        }
      if (key === 'reopenStage') return async (id: string) => retained(await value.call(target, id))
      if (key === 'move' || key === 'moveDirectory')
        return async (from: string, to: string) => {
          assertPath(from)
          assertPath(to)
          return value.call(target, from, to)
        }
      if (
        [
          'read',
          'stat',
          'fingerprint',
          'openRead',
          'writeAtomic',
          'beginAtomicWrite',
          'remove',
          'mkdir',
          'removeDirectory',
        ].includes(String(key)) ||
        key === Symbol.for('abele.sync.directory-identity-v1')
      )
        return async (path: string, ...args: unknown[]) => {
          if (!((key === 'openRead' || key === 'stat') && handles.has(path))) assertPath(path)
          const result = await value.call(target, path, ...args)
          return key === 'beginAtomicWrite' ? retained(result) : result
        }
      throw new EngineError('protocol', 'Filesystem operation has no scope policy: ' + String(key))
    },
  })
}
