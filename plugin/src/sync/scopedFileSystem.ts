import { PRIVATE_REMOVAL_FILES, privateRemovalFileSystem } from './privateRemovalFileSystem'
import { FINGERPRINT_UPLOAD, UPLOAD_READ } from './mobileWholeRead'
import { pathAdmission, EngineError, type FileSystem, type AtomicStage } from '@abele/sync-sdk/core'
import { PLACEMENT } from './pathCoordinator'
import { privatePlacementStages, PRIVATE_PLACEMENT_STAGES } from './privatePlacementStages'
import { IGNORE_FILE } from './scope'
import { INSTALL_BATCH, type InstallItem } from './nativeInstallBatch'

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
  privateRoot?: string,
  scopeRootInput?: string | (() => string)
): FileSystem {
  const handles = new Set<string>()
  const stages =
    Reflect.get(fs, PRIVATE_PLACEMENT_STAGES) ?? privatePlacementStages(fs, privateRoot)
  const privateStage = (path: string) =>
    !!privateRoot &&
    path.startsWith(privateRoot + '/writes/') &&
    /^\.abele-sync-[a-z0-9]{8}\.tmp$/.test(path.slice((privateRoot + '/writes/').length))
  const assertStage = (path: string) => {
    if (!handles.has(path) && !privateStage(path)) assertPath(path)
  }
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
      if (key === PRIVATE_REMOVAL_FILES) {
        const port = Reflect.get(target, key)
        return () => {
          const local = (path: string) => {
            assertPath(path)
            return path
          }
          return typeof port === 'function'
            ? port.call(target, local)
            : privateRemovalFileSystem(target, privateRoot, local)
        }
      }
      const value = Reflect.get(target, key)
      if (typeof value !== 'function') return value
      if (key === INSTALL_BATCH)
        return (
          items: InstallItem[],
          work: (fs: FileSystem, flush: () => Promise<void>) => Promise<unknown>
        ) => {
          for (const item of items) assertPath(item.path)
          return value.call(target, items, (view: FileSystem, flush: () => Promise<void>) =>
            work(scopedFileSystem(view, assertPath, includes, privateRoot, scopeRootInput), flush)
          )
        }
      // Comparing names is pure; it does not grant access to the named objects.
      if (key === 'pathKey') return value.bind(target)
      if (key === pathAdmission)
        return (path: string) => {
          assertPath(path)
          return value.call(target, path)
        }
      if (
        key === Symbol.for('abele.sync.inventory-pass-v1') ||
        key === Symbol.for('abele.sync.verify-inventory-root-v1') ||
        key === Symbol.for('abele.sync.operation-pass-v1') ||
        key === Symbol.for('abele.sync.retention-idle-v1')
      )
        return value.bind(target)
      if (key === Symbol.for('abele.sync.local-change-revision-v1'))
        return (path?: string) => {
          if (path !== undefined) assertPath(path)
          return value.call(target, path)
        }
      if (key === Symbol.for('abele.sync.inventory-directories-v1'))
        return async () =>
          (await value.call(target)).filter((info: { path: string }) => includes(info.path))
      if (key === 'listChildren' || key === Symbol.for('abele.sync.inventory-children-v1'))
        return async (parent: string, ...args: unknown[]) => {
          const scopeRoot = typeof scopeRootInput === 'function' ? scopeRootInput() : scopeRootInput
          if (scopeRoot && (parent === '' || scopeRoot.startsWith(parent + '/'))) {
            const path = scopeRoot
              .split('/')
              .slice(0, parent ? parent.split('/').length + 1 : 1)
              .join('/')
            if (path === scopeRoot) {
              const read = Reflect.get(target, Symbol.for('abele.sync.inventory-directories-v1'))
              const directories = read
                ? await read.call(target)
                : await (async () => {
                    const result = []
                    for await (const entry of target.listDirectories?.() ?? []) result.push(entry)
                    return result
                  })()
              const directory = directories.find((one: { path: string }) => one.path === path)
              return directory ? [{ ...directory, kind: 'directory' }] : []
            }
            return [{ path, kind: 'directory' }]
          }
          assertPath(parent)
          const children = await value.call(target, parent, ...args)
          return children.filter((info: { path: string }) => includes(info.path))
        }
      if (
        key === Symbol.for('abele.sync.diagnostic-v1') ||
        key === Symbol.for('abele.sync.replay-stage-v1')
      )
        return value.bind(target)
      if (
        key === Symbol.for('abele.sync.fingerprint-pull-v1') ||
        key === Symbol.for('abele.sync.cached-scan-hash-v1') ||
        key === Symbol.for('abele.sync.fingerprint-fresh-v1')
      )
        return (path: string, ...args: unknown[]) => {
          assertPath(path)
          return value.call(target, path, ...args)
        }
      if (key === Symbol.for('abele.sync.live-source-stage-v1'))
        return (id: string, work: () => Promise<unknown>) => {
          assertStage(id)
          return value.call(target, id, work)
        }
      if (key === Symbol.for('abele.sync.reopen-pull-stage-v1'))
        return async (id: string) => {
          assertStage(id)
          return retained(await value.call(target, id))
        }
      if (key === Symbol.for('abele.sync.recover-published-pull-v1'))
        return async (
          id: string | null,
          path: string,
          mtime: number,
          from: string | null,
          beforeCreate?: (id: string) => Promise<void>,
          ...recovery: unknown[]
        ) => {
          if (id !== null) assertStage(id)
          assertPath(path)
          if (from !== null && from !== undefined) assertPath(from)
          return retained(
            await value.call(target, id, path, mtime, from, beforeCreate, ...recovery)
          )
        }
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
      if (key === 'discardStage')
        return async (id: string) => {
          assertStage(id)
          return value.call(target, id)
        }
      if (key === 'conditionalFile' || key === Symbol.for('abele.sync.stream-move-source-v1'))
        return (operation: import('./conditionalFiles').ConditionalFileOperation) => {
          assertPath(operation.path)
          if (operation.effect.kind === 'move') assertPath(operation.effect.to)
          if (operation.effect.kind === 'remove' && operation.effect.retainAt !== undefined)
            assertPath(operation.effect.retainAt)
          if (operation.effect.kind === 'install') assertStage(operation.effect.stageId)
          return value.call(target, operation)
        }
      if (key === 'installedFile')
        return (receipt: string, path: string, sha: string) => {
          assertPath(path)
          return value.call(target, receipt, path, sha)
        }
      if (key === 'recoverConditionalFiles' || key === 'discardInstallation')
        return value.bind(target)
      if (key === 'reopenStage')
        return async (id: string) => {
          assertStage(id)
          return retained(await value.call(target, id))
        }
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
          'fileIdentity',
          'fingerprint',
          'openRead',
          'writeAtomic',
          'beginAtomicWrite',
          'remove',
          'mkdir',
          'removeDirectory',
        ].includes(String(key)) ||
        key === Symbol.for('abele.sync.directory-identity-v1') ||
        key === FINGERPRINT_UPLOAD ||
        key === UPLOAD_READ ||
        key === Symbol.for('abele.sync.written-stat-v1') ||
        key === Symbol.for('abele.sync.index-absent-v1')
      )
        return async (path: string, ...args: unknown[]) => {
          if (key === 'stat') assertStage(path)
          else if (!(key === 'openRead' && handles.has(path))) assertPath(path)
          const result = await value.call(target, path, ...args)
          return key === 'beginAtomicWrite' ? retained(result) : result
        }
      throw new EngineError('protocol', 'Filesystem operation has no scope policy: ' + String(key))
    },
  })
}
