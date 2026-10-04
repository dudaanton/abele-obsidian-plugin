import { App, TFile, TFolder, type EventRef, normalizePath } from 'obsidian'
import dayjs from '@/helpers/dateLibrary'
import { toRaw } from 'vue'
import { DATE_FORMAT } from '@/constants/dates'
import { isWikilink, wikilinkToPath } from '@/helpers/pathsHelpers'
import { RelationBatchRouter, type RelationChange } from './RelationBatchRouter'

class VaultRelationBatches {
  readonly router = new RelationBatchRouter()
  references = 0
  private readonly events: EventRef[] = []
  private readonly pending: RelationChange[] = []
  private readonly changedPositions = new Map<TFile, number>()
  private closed = false
  constructor(private readonly app: App) {
    const queue = (kind: RelationChange['kind'], file: unknown, oldPath?: string) => {
      if (this.closed) return
      if (file instanceof TFolder && kind !== 'changed') {
        const prefix = normalizePath(oldPath ?? file.path) + '/'
        const watched = new Set(this.router.watchedPaths())
        // Snapshot queue identities once; per-descendant reverse searches are quadratic.
        const pendingIdentityByPath = new Map<string, unknown>()
        for (const change of this.pending) {
          pendingIdentityByPath.set(change.path, change.identity)
          if (change.kind === 'rename') {
            watched.delete(change.oldPath!)
            watched.add(change.path)
          } else if (change.kind === 'delete') watched.delete(change.path)
        }
        for (const path of watched) {
          if (!path.startsWith(prefix) || app.vault.getAbstractFileByPath(path)) continue
          const next =
            kind === 'rename' ? normalizePath(file.path) + '/' + path.slice(prefix.length) : path
          if (kind === 'rename' && !(app.vault.getAbstractFileByPath(next) instanceof TFile))
            continue
          const identity = app.vault.getAbstractFileByPath(next) ?? pendingIdentityByPath.get(path)
          const change: RelationChange =
            kind === 'rename'
              ? { kind, path: next, oldPath: path, identity: toRaw(identity) }
              : { kind, path, identity: toRaw(identity) }
          this.pending.push(change)
          pendingIdentityByPath.set(change.path, change.identity)
        }
        return
      }
      if (!(file instanceof TFile)) return
      const change = {
        kind,
        identity: toRaw(file),
        path: normalizePath(file.path),
        ...(oldPath ? { oldPath: normalizePath(oldPath) } : {}),
      }
      if (kind !== 'changed') this.pending.push(change)
      else {
        const position = this.changedPositions.get(file)
        if (position === undefined) {
          this.changedPositions.set(file, this.pending.length)
          this.pending.push(change)
        } else this.pending[position] = change
      }
    }
    this.events.push(app.metadataCache.on('changed', (file) => queue('changed', file)))
    this.events.push(app.metadataCache.on('resolved', () => this.flush()))
    this.events.push(app.vault.on('rename', (file, oldPath) => queue('rename', file, oldPath)))
    this.events.push(app.vault.on('delete', (file) => queue('delete', file)))
  }
  private flush() {
    if (this.closed) return
    const changes = this.pending.splice(0)
    this.changedPositions.clear()
    const metadata = new Map<string, Record<string, any> | undefined>()
    let links: Record<string, Record<string, number>> | undefined
    const read = (path: string) => {
      if (!metadata.has(path)) {
        const file = this.app.vault.getAbstractFileByPath(path)
        metadata.set(
          path,
          file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined
        )
      }
      return metadata.get(path)
    }
    const targets = (path: string) => {
      links ??= this.app.metadataCache.resolvedLinks
      return Object.keys(links[path] ?? {}).filter((target) => links[path][target])
    }
    const parents = new Map<string, string[]>()
    const parentPaths = (path: string) => {
      if (!parents.has(path)) {
        const groups = read(path)?.groups
        const linked = targets(path)
        const result: string[] = []
        if (Array.isArray(groups))
          for (const group of groups) {
            if (!isWikilink(group)) continue
            const file = this.app.metadataCache.getFirstLinkpathDest(wikilinkToPath(group), path)
            if (file && file.path !== path && linked.includes(file.path)) result.push(file.path)
          }
        parents.set(path, result)
      }
      return parents.get(path)!
    }
    const ancestry = new Map<string, Set<string>>()
    const ancestors = (path: string) => {
      if (!ancestry.has(path)) {
        const reached = new Set<string>()
        const stack = [...targets(path)]
        while (stack.length) {
          const target = stack.pop()!
          if (reached.has(target)) continue
          reached.add(target)
          stack.push(...parentPaths(target))
        }
        ancestry.set(path, reached)
      }
      return ancestry.get(path)!
    }
    this.router.dispatch(
      changes,
      ancestors,
      (path) => {
        const fm = read(path)
        const value = fm?.due ?? fm?.date ?? fm?.created
        const date = value ? dayjs(value, DATE_FORMAT) : null
        return date?.isValid() ? date.format(DATE_FORMAT) : null
      },
      (error) => console.error('[Abele] relation batch could not apply a change', error)
    )
  }
  dispose() {
    this.closed = true
    this.pending.length = 0
    this.changedPositions.clear()
    for (const ref of this.events) {
      this.app.vault.offref(ref)
      this.app.metadataCache.offref(ref)
    }
  }
}
const batches = new WeakMap<App, VaultRelationBatches>()
export function acquireVaultRelationBatches(app: App) {
  let service = batches.get(app)
  if (!service) {
    service = new VaultRelationBatches(app)
    batches.set(app, service)
  }
  service.references++
  let released = false
  return {
    router: service.router,
    release: () => {
      if (released) return
      released = true
      if (--service.references === 0) {
        service.dispose()
        batches.delete(app)
      }
    },
  }
}
