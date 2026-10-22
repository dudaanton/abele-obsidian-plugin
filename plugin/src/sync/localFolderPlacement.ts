import { FINGERPRINT_UPLOAD, UPLOAD_READ } from './mobileWholeRead'
import type { FileSystem, StateStore, StateEntry, AtomicStage } from '@abele/sync-sdk/core'
import { assertPhysicalPath } from './external/projection'
import { privatePlacementStages, PRIVATE_PLACEMENT_STAGES } from './privatePlacementStages'
import { IGNORE_FILE } from './scope'
import { PLACEMENT } from './pathCoordinator'

export { FolderScopeError } from './scopedFileSystem'
import { FolderScopeError } from './scopedFileSystem'

export class LocalPlacementError extends Error {
  readonly code = 'local-placement'
}

type PlacementFileSystem = FileSystem & {
  readPrefix?(path: string, maximum: number): Promise<Uint8Array>
}
// Adding a filesystem operation requires an explicit path/identity policy.
export const placementMethods = {
  list: 'list',
  listDirectories: 'list',
  listChildren: 'children',
  watch: 'watch',
  read: 'path',
  readPrefix: 'path',
  writeAtomic: 'path',
  remove: 'path',
  stat: 'path',
  mkdir: 'path',
  removeDirectory: 'path',
  openRead: 'path',
  fingerprint: 'path',
  beginAtomicWrite: 'path',
  move: 'pair',
  moveDirectory: 'pair',
  reopenStage: 'identity',
} satisfies Record<
  keyof PlacementFileSystem,
  'list' | 'watch' | 'path' | 'pair' | 'identity' | 'children'
>
/** The host's received-directory identity lookup takes one vault path. */
const DIRECTORY_IDENTITY = Symbol.for('abele.sync.directory-identity-v1')

/** The engine and its ledger keep server paths; only filesystem calls use local paths. */
export class LocalFolderPlacement {
  constructor(
    public server: string,
    public local: string
  ) {}
  private replace(path: string, from: string, to: string, incoming: boolean): string {
    const normalized = path,
      root = from
    try {
      assertPhysicalPath(normalized)
      if (normalized === root || normalized.startsWith(root + '/'))
        return to + normalized.slice(root.length)
    } catch {
      /* Refuse aliases and traversal as well as unrelated roots. */
    }
    if (incoming)
      throw new FolderScopeError(
        `The server returned a path outside this connection; sync stopped: ${path}`
      )
    throw new LocalPlacementError('The local path is outside this connection; sync stopped')
  }
  toLocal(path: string): string {
    return this.replace(path, this.server, this.local, true)
  }
  toServer(path: string): string {
    return this.replace(path, this.local, this.server, false)
  }
  localMetadata<T>(value: T): T {
    if (Array.isArray(value)) return value.map((item) => this.localMetadata(item)) as T
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
      return value
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        ['path', 'prev_path', 'previousPath', 'conflict_path'].includes(key) &&
        typeof item === 'string'
          ? this.toLocal(item)
          : key === 'paths' && Array.isArray(item)
            ? item.map((path) => (typeof path === 'string' ? this.toLocal(path) : path))
            : this.localMetadata(item),
      ])
    ) as T
  }
  localFileSystem(fs: FileSystem): FileSystem {
    return new Proxy(this, {
      get(target, key) {
        if (key === 'server') return target.local
        if (key === 'local') return target.server
        return Reflect.get(target, key)
      },
    }).fileSystem(fs)
  }
  localState(store: StateStore): StateStore {
    const local = (entry: StateEntry | null) =>
      entry ? { ...entry, path: this.toLocal(entry.path) } : null
    const toServer = (path: string) => this.toServer(path)
    return new Proxy(store, {
      get(target, key) {
        if (key === 'get') return async (path: string) => local(await target.get(toServer(path)))
        if (key === 'byFileId') return async (id: string) => local(await target.byFileId(id))
        if (key === 'all')
          return async function* () {
            for await (const entry of target.all()) yield local(entry)
          }
        if (key === 'put')
          return (entry: StateEntry) => target.put({ ...entry, path: toServer(entry.path) })
        if (key === 'delete') return (path: string) => target.delete(toServer(path))
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
  fileSystem(fs: FileSystem): FileSystem {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Proxy calls read the current placement after a local follow.
    const placement = this
    const stages = Reflect.get(fs, PRIVATE_PLACEMENT_STAGES) ?? privatePlacementStages(fs)
    // Opaque stage handles are authorized only by this filesystem allocating/reopening them.
    const handles = new Set<string>()
    const retainedStage = <T extends AtomicStage>(stage: T): T => {
      handles.add(stage.id)
      if (!stage.discard) return stage
      return new Proxy(stage, {
        get(target, key) {
          const value = Reflect.get(target, key)
          if ((key === 'discard' || key === 'commit') && typeof value === 'function')
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
        if (key === 'conditionalFile')
          return (operation: import('./conditionalFiles').ConditionalFileOperation) =>
            value.call(target, {
              ...operation,
              path: placement.toLocal(operation.path),
              effect:
                operation.effect.kind === 'move'
                  ? { ...operation.effect, to: placement.toLocal(operation.effect.to) }
                  : operation.effect,
            })
        if (key === 'installedFile')
          return (receipt: string, path: string, sha: string) =>
            value.call(target, receipt, placement.toLocal(path), sha)
        if (key === 'recoverConditionalFiles') return value.bind(target)
        if (key === Symbol.for('abele.sync.local-change-revision-v1'))
          return (path?: string) =>
            value.call(target, path === undefined ? undefined : placement.toLocal(path))
        if (
          [
            Symbol.for('abele.sync.inventory-pass-v1'),
            Symbol.for('abele.sync.diagnostic-v1'),
            Symbol.for('abele.sync.replay-stage-v1'),
            Symbol.for('abele.sync.trace-pull-v1'),
          ].includes(key as symbol)
        )
          return value.bind(target)
        if (key === Symbol.for('abele.sync.inventory-directories-v1'))
          return async () =>
            (await value.call(target))
              .filter(
                (item: { path: string }) =>
                  item.path === placement.local || item.path.startsWith(placement.local + '/')
              )
              .map((item: { path: string }) => ({ ...item, path: placement.toServer(item.path) }))
        if (
          [
            Symbol.for('abele.sync.fingerprint-fresh-v1'),
            Symbol.for('abele.sync.fingerprint-pull-v1'),
          ].includes(key as symbol)
        )
          return (path: string) => value.call(target, placement.toLocal(path))
        if (key === FINGERPRINT_UPLOAD || key === UPLOAD_READ)
          return (path: string, ...args: unknown[]) =>
            value.call(target, placement.toLocal(path), ...args)
        if (key === Symbol.for('abele.sync.live-source-stage-v1')) return value.bind(target)
        if (key === Symbol.for('abele.sync.reopen-pull-stage-v1'))
          return async (id: string) => retainedStage(await value.call(target, id))
        if (key === Symbol.for('abele.sync.recover-published-pull-v1'))
          return async (id: string | null, path: string, mtime: number, from: string | null) =>
            retainedStage(
              await value.call(
                target,
                id,
                placement.toLocal(path),
                mtime,
                from == null ? from : placement.toLocal(from)
              )
            )
        if (key === 'listChildren' || key === Symbol.for('abele.sync.inventory-children-v1'))
          return async (parent: string, ...args: unknown[]) => {
            if (parent === '' || placement.server.startsWith(parent + '/')) {
              const path = placement.server
                .split('/')
                .slice(0, parent ? parent.split('/').length + 1 : 1)
                .join('/')
              if (path !== placement.server) return [{ path, kind: 'directory' }]
              const read = Reflect.get(target, Symbol.for('abele.sync.inventory-directories-v1'))
              const directories = read
                ? await read.call(target)
                : await Array.fromAsync(target.listDirectories?.() ?? [])
              const root = directories.find(
                (item: { path: string }) => item.path === placement.local
              )
              return root ? [{ ...root, path, kind: 'directory' }] : []
            }
            return (await value.call(target, placement.toLocal(parent), ...args)).map(
              (item: { path: string }) => ({ ...item, path: placement.toServer(item.path) })
            )
          }
        const policy =
          key === DIRECTORY_IDENTITY ||
          key === Symbol.for('abele.sync.written-stat-v1') ||
          key === Symbol.for('abele.sync.index-absent-v1')
            ? 'path'
            : placementMethods[key as keyof PlacementFileSystem]
        if (policy === 'list')
          return async function* () {
            for await (const item of value.call(target)) {
              if (item.path === placement.local || item.path.startsWith(placement.local + '/'))
                yield { ...item, path: placement.toServer(item.path) }
            }
          }
        if (policy === 'watch')
          return (notify: (paths: string[]) => void) =>
            value.call(target, (paths: string[]) => {
              const included = paths.filter(
                (path) =>
                  path === IGNORE_FILE ||
                  path === placement.local ||
                  path.startsWith(placement.local + '/')
              )
              if (included.length)
                notify(
                  included.map((path) => (path === IGNORE_FILE ? path : placement.toServer(path)))
                )
            })
        if (key === PLACEMENT)
          return (
            paths: string[],
            work: () => Promise<unknown>,
            preserve: boolean | readonly string[] = true
          ) =>
            value.call(
              target,
              paths.map((path) => placement.toLocal(path)),
              work,
              typeof preserve === 'boolean'
                ? preserve
                : preserve.map((path) => placement.toLocal(path))
            )
        if (policy === 'pair')
          return (from: string, to: string) =>
            value.call(target, placement.toLocal(from), placement.toLocal(to))
        if (policy === 'path')
          return async (path: string, ...args: unknown[]) => {
            const handle = (key === 'stat' || key === 'openRead') && handles.has(path)
            const result = await value.call(
              target,
              handle ? path : placement.toLocal(path),
              ...args
            )
            if (key === 'beginAtomicWrite') return retainedStage(result)
            return key === 'stat' && result && !handle
              ? { ...result, path: placement.toServer(result.path) }
              : result
          }
        // Opaque stage locators never pass through server-to-local path mapping.
        if (key === 'discardStage') return (id: string) => value.call(target, id)
        if (policy === 'identity')
          return async (id: string) => {
            const stage = await value.call(target, id)
            return retainedStage(stage)
          }
        throw new LocalPlacementError(
          `Filesystem operation has no placement policy: ${String(key)}`
        )
      },
    })
  }
}
