import { PRIVATE_REMOVAL_FILES, privateRemovalFileSystem } from './privateRemovalFileSystem'
import { pathAdmission } from '@abele/sync-sdk/core'
import { caseKey, AbeleError } from '@abele/sync-sdk/protocol'
import { FINGERPRINT_UPLOAD, UPLOAD_READ } from './mobileWholeRead'
import type {
  FileSystem,
  FileInfo,
  StateStore,
  StateEntry,
  AtomicStage,
} from '@abele/sync-sdk/core'
import { assertPhysicalPath } from './external/projection'
import { privatePlacementStages, PRIVATE_PLACEMENT_STAGES } from './privatePlacementStages'
import { IGNORE_FILE } from './scope'
import { PLACEMENT } from './pathCoordinator'
import { SyncTaskBudget } from './syncTaskBudget'
import { INSTALL_BATCH, type InstallItem } from './nativeInstallBatch'

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
  [pathAdmission]: 'key',
  pathKey: 'key',
  list: 'list',
  listDirectories: 'list',
  listChildren: 'children',
  watch: 'watch',
  read: 'path',
  readPrefix: 'path',
  writeAtomic: 'path',
  remove: 'path',
  stat: 'path',
  fileIdentity: 'path',
  mkdir: 'path',
  removeDirectory: 'path',
  openRead: 'path',
  fingerprint: 'path',
  deferNewLocalFile: 'info',
  beginAtomicWrite: 'path',
  move: 'pair',
  moveDirectory: 'pair',
  reopenStage: 'identity',
  discardStage: 'opaque',
  conditionalFile: 'opaque',
  conditionalOwnership: 'opaque',
  trustedIndexIdentities: 'opaque',
  trustedPathCandidates: 'opaque',
  conditionalCapture: 'opaque',
  installedFile: 'opaque',
  discardInstallation: 'opaque',
  recoverConditionalFiles: 'opaque',
} satisfies Record<
  keyof PlacementFileSystem,
  'list' | 'watch' | 'path' | 'pair' | 'identity' | 'children' | 'opaque' | 'key' | 'info'
>
/** The host's received-directory identity lookup takes one vault path. */
const DIRECTORY_IDENTITY = Symbol.for('abele.sync.directory-identity-v1')

/** The engine and its ledger keep server paths; only filesystem calls use local paths. */
export class LocalFolderPlacement {
  private localMappings = new Map<string, string>()
  private mappingRoots: readonly [string, string] | undefined
  constructor(
    public server: string,
    public local: string
  ) {}
  private replace(
    path: string,
    from: string,
    to: string,
    incoming: boolean,
    caller: string,
    enumeration = false
  ): string {
    const normalized = path,
      root = from
    if (
      (normalized === root || normalized.startsWith(root + '/')) &&
      !/^(?:\/|\\|[a-z]:)/i.test(path) &&
      !path.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      // Preserve invalid inventory names for the scanner skipped-file report.
      // Scalar effects still validate names; malformed structure remains a scope error.
      if (!enumeration) {
        try {
          assertPhysicalPath(normalized)
        } catch (error) {
          throw new AbeleError(
            'invalid_path',
            `Invalid ${incoming ? 'server' : 'local'} path (${caller}): ${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
      return to + normalized.slice(root.length)
    }
    if (incoming)
      throw new FolderScopeError(
        `The server returned a path outside this connection; sync stopped: ${path}`
      )
    // Keep vault-relative names useful for diagnosis without leaking an absolute host path.
    const rejected = /^(?:\/|\\|[a-z]:)/i.test(path)
      ? 'absolute path: ' + path.split(/[\\/]/).at(-1)
      : path
    throw new LocalPlacementError(
      `The local path is outside this connection; sync stopped (${caller}): ${JSON.stringify(rejected)}`
    )
  }
  toLocal(path: string): string {
    if (this.mappingRoots?.[0] !== this.server || this.mappingRoots?.[1] !== this.local) {
      this.localMappings.clear()
      this.mappingRoots = [this.server, this.local]
    }
    const known = this.localMappings.get(path)
    if (known !== undefined) return known
    const local = this.replace(path, this.server, this.local, true, 'toLocal')
    if (this.localMappings.size >= 131072) this.localMappings.clear()
    this.localMappings.set(path, local)
    return local
  }
  toServer(path: string, caller = 'toServer', enumeration = false): string {
    return this.replace(path, this.local, this.server, false, caller, enumeration)
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
  localState<T extends StateStore>(store: T): T {
    const toLocal = (path: string) => this.toLocal(path)
    const local = (entry: StateEntry | null) =>
      entry ? { ...entry, path: toLocal(entry.path) } : null
    const toServer = (path: string) => this.toServer(path, 'localState')
    const placed = (tx: StateStore) => this.localState(tx)
    return new Proxy(store, {
      get(target, key) {
        if (key === 'transaction')
          return <T>(work: (tx: StateStore) => Promise<T>) =>
            target.transaction((tx) => work(placed(tx)))
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
        if (key === Symbol.for('abele.sync.feed-entries-v1') && typeof value === 'function')
          return async (ids: readonly string[], signal?: AbortSignal) =>
            ((await value.call(target, ids, signal)) as StateEntry[]).map(local)
        if (key === 'readCommittedEntries' && typeof value === 'function')
          return async (paths: readonly string[]) => {
            const entries = (await value.call(target, paths.map(toServer))) as StateEntry[]
            return entries.map((entry) => ({ ...entry, path: toLocal(entry.path) }))
          }
        if (key === 'observeCommittedEntries' && typeof value === 'function')
          return (observer: (entries: StateEntry[]) => Promise<void>) =>
            value.call(target, (entries: StateEntry[]) =>
              observer(entries.map((entry) => ({ ...entry, path: toLocal(entry.path) })))
            )
        if (key === 'pathCandidates' && typeof value === 'function')
          return async function* (path: string, nameKey?: (path: string) => string) {
            const mappedKey = nameKey
              ? (candidate: string) => nameKey(toLocal(candidate))
              : undefined
            for await (const entry of value.call(target, toServer(path), mappedKey))
              yield local(entry)
          }
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
        if (key === PRIVATE_REMOVAL_FILES) {
          const port = Reflect.get(target, key)
          return (toLocal: (path: string) => string = (path) => path) =>
            typeof port === 'function'
              ? port.call(target, (path: string) => placement.toLocal(toLocal(path)))
              : privateRemovalFileSystem(target, undefined, (path) =>
                  placement.toLocal(toLocal(path))
                )
        }
        const value = Reflect.get(target, key)
        if (key === 'trustedPathCandidates' && value) {
          const port: NonNullable<FileSystem['trustedPathCandidates']> = value
          return {
            lookup: async (directory: string, name: string) => {
              const root = placement.server
              if (directory === '' || root.startsWith(directory + '/')) {
                const next = root
                  .split('/')
                  .slice(0, directory ? directory.split('/').length + 1 : 1)
                  .join('/')
                if (caseKey(next.slice(next.lastIndexOf('/') + 1)) !== caseKey(name)) return []
                const local = placement.local,
                  split = local.lastIndexOf('/')
                const rows = await port.lookup(
                  split < 0 ? '' : local.slice(0, split),
                  local.slice(split + 1)
                )
                return rows
                  ?.filter((row) => row.path === local)
                  .map((row) =>
                    next === root
                      ? { ...row, path: next }
                      : { path: next, kind: 'directory' as const }
                  )
              }
              if (directory !== root && !directory.startsWith(root + '/')) return undefined
              const rows = await port.lookup(placement.toLocal(directory), name)
              return rows?.map((row) => ({
                ...row,
                path: placement.toServer(row.path, 'trustedPathCandidates.lookup', true),
              }))
            },
            lstat: async (path: string) => {
              if (placement.server.startsWith(path + '/')) {
                const stat = await port.lstat(placement.local)
                return stat?.kind === 'directory' ? { kind: 'directory' as const } : stat
              }
              return port.lstat(placement.toLocal(path))
            },
          } satisfies NonNullable<FileSystem['trustedPathCandidates']>
        }
        if (typeof value !== 'function') return value
        if (
          key === Symbol.for('abele.sync.unchanged-index-path-v1') ||
          key === Symbol.for('abele.sync.unchanged-index-reason-v1')
        )
          return (path: string) => value.call(target, placement.toLocal(path))
        if (key === Symbol.for('abele.sync.local-scan-revision-v1'))
          return () => {
            const revision = value.call(target)
            return revision === undefined
              ? undefined
              : JSON.stringify([placement.server, placement.local, revision])
          }
        if (key === INSTALL_BATCH)
          return (
            items: InstallItem[],
            work: (fs: FileSystem, flush: () => Promise<void>) => Promise<unknown>
          ) =>
            value.call(
              target,
              items.map((item) => ({ ...item, path: placement.toLocal(item.path) })),
              (view: FileSystem, flush: () => Promise<void>) =>
                work(placement.fileSystem(view), flush)
            )
        if (key === 'conditionalFile' || key === Symbol.for('abele.sync.stream-move-source-v1'))
          return (operation: import('./conditionalFiles').ConditionalFileOperation) =>
            value.call(target, {
              ...operation,
              path: placement.toLocal(operation.path),
              effect:
                operation.effect.kind === 'move'
                  ? { ...operation.effect, to: placement.toLocal(operation.effect.to) }
                  : operation.effect.kind === 'remove' && operation.effect.retainAt !== undefined
                    ? {
                        ...operation.effect,
                        retainAt: placement.toLocal(operation.effect.retainAt),
                      }
                    : operation.effect,
            })
        if (key === 'installedFile')
          return (receipt: string, path: string, sha: string) =>
            value.call(target, receipt, placement.toLocal(path), sha)
        if (key === 'recoverConditionalFiles' || key === 'discardInstallation')
          return value.bind(target)
        if (
          key === Symbol.for('abele.sync.local-change-revision-v1') ||
          key === Symbol.for('abele.sync.watch-revision-v1')
        )
          return (path?: string) =>
            value.call(target, path === undefined ? undefined : placement.toLocal(path))
        if (
          [
            // Pathless proof retirement changes no namespace and grants no file access.
            Symbol.for('abele.sync.invalidate-local-scan-v1'),
            Symbol.for('abele.sync.inspect-polled-v1'),
            Symbol.for('abele.sync.inventory-pass-v1'),
            Symbol.for('abele.sync.inventory-id-v1'),
            Symbol.for('abele.sync.watch-epoch-v1'),
            Symbol.for('abele.sync.verify-inventory-root-v1'),
            Symbol.for('abele.sync.operation-pass-v1'),
            Symbol.for('abele.sync.retention-idle-v1'),
            Symbol.for('abele.sync.diagnostic-v1'),
            Symbol.for('abele.sync.prefix-read-wait-v1'),
            Symbol.for('abele.sync.scan-hash-counts-v1'),
            Symbol.for('abele.sync.replay-stage-v1'),
            Symbol.for('abele.sync.trace-pull-v1'),
            Symbol.for('abele.sync.install-batch-proof-v1'),
          ].includes(key as symbol)
        )
          return value.bind(target)
        if (key === Symbol.for('abele.sync.inventory-directories-v1'))
          return async (...args: unknown[]) => {
            // Capture the current scope once per scan. A subsequent scan observes a local follow.
            const root = placement.local,
              prefix = root + '/'
            const budget = new SyncTaskBudget()
            const projected = []
            for (const item of await value.call(target, ...args)) {
              if (item.path === root || item.path.startsWith(prefix))
                projected.push({
                  ...item,
                  path: placement.toServer(item.path, String(key) + '.result', true),
                })
              // At most 256 entries or 8 ms of projection before a renderer task boundary.
              const pause = budget.account(4096)
              if (pause !== undefined) await pause
            }
            return projected
          }
        if (
          [
            Symbol.for('abele.sync.fingerprint-fresh-v1'),
            Symbol.for('abele.sync.cached-scan-hash-v1'),
            Symbol.for('abele.sync.fingerprint-pull-v1'),
          ].includes(key as symbol)
        )
          return (path: string, ...args: unknown[]) =>
            value.call(target, placement.toLocal(path), ...args)
        if (key === FINGERPRINT_UPLOAD || key === UPLOAD_READ)
          return (path: string, ...args: unknown[]) =>
            value.call(target, placement.toLocal(path), ...args)
        if (key === Symbol.for('abele.sync.live-source-stage-v1')) return value.bind(target)
        if (key === Symbol.for('abele.sync.reopen-pull-stage-v1'))
          return async (id: string) => retainedStage(await value.call(target, id))
        if (key === Symbol.for('abele.sync.recover-published-pull-v1'))
          return async (
            id: string | null,
            path: string,
            mtime: number,
            from: string | null,
            beforeCreate?: (id: string) => Promise<void>,
            ...recovery: unknown[]
          ) =>
            retainedStage(
              await value.call(
                target,
                id,
                placement.toLocal(path),
                mtime,
                from == null ? from : placement.toLocal(from),
                beforeCreate,
                ...recovery
              )
            )
        if (key === Symbol.for('abele.sync.inventory-directory-v1'))
          return async (path: string) => {
            const row = await value.call(target, placement.toLocal(path))
            return row
              ? { ...row, path: placement.toServer(row.path, String(key) + '.result', true) }
              : null
          }
        if (key === 'listChildren' || key === Symbol.for('abele.sync.inventory-children-v1'))
          return async (parent: string, ...args: unknown[]) => {
            if (parent === '' || placement.server.startsWith(parent + '/')) {
              const path = placement.server
                .split('/')
                .slice(0, parent ? parent.split('/').length + 1 : 1)
                .join('/')
              if (path !== placement.server) return [{ path, kind: 'directory' }]
              // A scoped ancestor needs one directory proof, not a projection of
              // every directory for every incoming file.
              const lookup = Reflect.get(target, Symbol.for('abele.sync.inventory-directory-v1'))
              const read = Reflect.get(target, Symbol.for('abele.sync.inventory-directories-v1'))
              const root = lookup
                ? await lookup.call(target, placement.local)
                : (read
                    ? await read.call(target)
                    : await Array.fromAsync(target.listDirectories?.() ?? [])
                  ).find((item: { path: string }) => item.path === placement.local)
              return root ? [{ ...root, path, kind: 'directory' }] : []
            }
            const children = await value.call(target, placement.toLocal(parent), ...args)
            const result = [],
              budget = new SyncTaskBudget()
            for (const item of children) {
              const pause = budget.account(0)
              if (pause !== undefined) await pause
              result.push({
                ...item,
                path: placement.toServer(item.path, String(key) + '.result', true),
              })
            }
            return result
          }
        const policy =
          key === Symbol.for('abele.sync.scan-hash-ready-v1')
            ? 'info'
            : key === DIRECTORY_IDENTITY ||
                key === Symbol.for('abele.sync.written-stat-v1') ||
                key === Symbol.for('abele.sync.index-absent-v1')
              ? 'path'
              : placementMethods[key as keyof PlacementFileSystem]
        if (policy === 'info')
          return (info: FileInfo, ...args: unknown[]) =>
            value.call(target, { ...info, path: placement.toLocal(info.path) }, ...args)
        if (policy === 'key') return (path: string) => value.call(target, placement.toLocal(path))
        if (policy === 'list')
          return async function* () {
            const root = placement.local,
              prefix = root + '/'
            const budget = new SyncTaskBudget()
            for await (const item of value.call(target)) {
              if (item.path === root || item.path.startsWith(prefix))
                yield {
                  ...item,
                  path: placement.toServer(item.path, String(key) + '.result', true),
                }
              const pause = budget.account(4096)
              if (pause !== undefined) await pause
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
                  included.map((path) =>
                    path === IGNORE_FILE ? path : placement.toServer(path, 'watch.result')
                  )
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
              ? { ...result, path: placement.toServer(result.path, 'stat.result') }
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
