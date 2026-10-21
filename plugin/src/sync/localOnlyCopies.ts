import { caseKey } from '@abele/sync-sdk/protocol'
import type { TokenConnectionRegistry } from './tokenConnectionRegistry'

export const LOCAL_ONLY_COPIES = 'abele-sync-local-only-copies-v1'
const slots = ['abele-sync-token-state:local-only', 'abele-sync-token-state:local-only-pending']
interface Copy {
  id: string
  path: string
  ledgerId: string
}
/** Device identities follow the same vault rename events as pinned files. */
export class LocalOnlyCopies {
  private paths: string[] = []
  private unsaved?: Copy[]
  private pendingChanges: { id: string; slot: string; paths: string[] }[] = []
  constructor(private registry: TokenConnectionRegistry) {
    this.refresh()
  }
  physical(record: ReturnType<TokenConnectionRegistry['records']>[number], path: string) {
    const root = record.scope?.kind === 'folder' ? record.scope.path : undefined
    if (
      root &&
      root !== '/' &&
      record.localRoot &&
      (path === root || path.startsWith(root + '/'))
    ) {
      const suffix = path.slice(root.length).replace(/^\//, '')
      return record.localRoot === '/'
        ? suffix || '/'
        : record.localRoot + (suffix ? '/' + suffix : '')
    }
    return path
  }
  private copies(): Copy[] {
    return (
      this.unsaved ??
      ((this.registry.localStorage.loadLocalStorage(LOCAL_ONLY_COPIES) ?? []) as Copy[])
    )
  }
  refresh(): void {
    this.paths = [...this.copies().map((one) => one.path)]
    for (const record of this.registry.records())
      for (const slot of slots)
        for (const path of (record.state[slot] ?? []) as string[])
          this.paths.push(this.physical(record, path))
  }
  has(path: string): boolean {
    return this.paths.some(
      (root) =>
        root === '/' ||
        caseKey(path) === caseKey(root) ||
        caseKey(path).startsWith(caseKey(root) + '/')
    )
  }
  deleted(path: string): void {
    const matches = (candidate: string) =>
      caseKey(candidate) === caseKey(path) || caseKey(candidate).startsWith(caseKey(path) + '/')
    if (!this.paths.some(matches)) return
    for (const record of this.registry.records())
      for (const slot of slots) {
        const paths = (record.state[slot] ?? []) as string[]
        const remaining = paths.filter((one) => !matches(this.physical(record, one)))
        if (remaining.length !== paths.length) {
          this.pendingChanges = this.pendingChanges.filter(
            (one) => one.id !== record.id || one.slot !== slot
          )
          this.pendingChanges.push({ id: record.id, slot, paths: remaining })
        }
      }
    this.persistRename(this.copies().filter((one) => !matches(one.path)))
  }
  async forgetMissing(path: string, exists: (path: string) => Promise<boolean>): Promise<void> {
    if (await exists(path))
      throw new Error('The kept copy exists; it cannot be forgotten as missing')
    this.deleted(path)
  }
  async assertPublishSafe(
    exists: (path: string) => Promise<boolean>,
    report?: (paths: string[]) => void
  ): Promise<void> {
    if (this.unsaved || this.pendingChanges.length) this.persistRename(this.copies())
    this.refresh()
    // A lost rename destination can be anywhere in the vault, including another connection.
    // Do not guess from a basename or allow any engine to publish before it is resolved.
    const missing: string[] = []
    for (const path of new Set(this.paths)) if (!(await exists(path))) missing.push(path)
    report?.(missing)
    if (missing.length)
      throw new Error(
        'Cannot sync: a saved kept-copy path is missing; its location must be resolved before syncing: ' +
          missing[0]
      )
  }
  renamed(from: string, to: string): void {
    const matches = (path: string) =>
      caseKey(path) === caseKey(from) || caseKey(path).startsWith(caseKey(from) + '/')
    const original = this.copies()
    const copies = original.map((one) =>
      matches(one.path) ? { ...one, path: to + one.path.slice(from.length) } : one
    )
    const changes: { id: string; slot: string; paths: string[] }[] = []
    for (const record of this.registry.records())
      for (const slot of slots) {
        const paths = (record.state[slot] ?? []) as string[]
        const remaining: string[] = []
        for (const path of paths) {
          const physical = this.physical(record, path)
          if (matches(physical)) {
            const moved = to + physical.slice(from.length)
            if (!copies.some((one) => caseKey(one.path) === caseKey(moved)))
              copies.push({ id: crypto.randomUUID(), path: moved, ledgerId: record.ledgerId })
          } else remaining.push(path)
        }
        if (remaining.length !== paths.length)
          changes.push({ id: record.id, slot, paths: remaining })
      }
    if (!changes.length && JSON.stringify(copies) === JSON.stringify(original)) return
    for (const change of changes) {
      this.pendingChanges = this.pendingChanges.filter(
        (one) => one.id !== change.id || one.slot !== change.slot
      )
      this.pendingChanges.push(change)
    }
    this.persistRename(copies)
  }
  private persistRename(copies: Copy[]): void {
    this.save(copies)
    for (const change of this.pendingChanges) {
      const storage = this.registry.storage(change.id)
      storage.saveLocalStorage(change.slot, change.paths)
      if (JSON.stringify(storage.loadLocalStorage(change.slot)) !== JSON.stringify(change.paths))
        throw new Error('Could not retain kept-copy paths')
    }
    this.pendingChanges = []
    this.refresh()
  }
  private save(copies: Copy[]): void {
    // Rename events arrive after the disk move. Fence the destination before any fallible IO.
    this.unsaved = copies
    this.refresh()
    this.registry.localStorage.saveLocalStorage(LOCAL_ONLY_COPIES, copies)
    if (
      JSON.stringify(this.registry.localStorage.loadLocalStorage(LOCAL_ONLY_COPIES)) !==
      JSON.stringify(copies)
    )
      throw new Error('Could not retain kept-copy identities')
    this.unsaved = undefined
  }
  async releaseSelected(
    id: string,
    paths: string[],
    retire: (selected: (path: string) => boolean) => Promise<void> = async () => {}
  ): Promise<void> {
    // A failed rename must become durable before any exclusion can be released.
    if (this.unsaved || this.pendingChanges.length) this.persistRename(this.copies())
    const issuer = this.registry.records().find((one) => one.id === id)
    if (!issuer) throw new Error('Connection unavailable')
    const roots = paths.map((path) => this.physical(issuer, path))
    const selected = (path: string) =>
      roots.some(
        (root) =>
          root === '/' ||
          caseKey(path) === caseKey(root) ||
          caseKey(path).startsWith(caseKey(root) + '/')
      )
    const held = (path: string) => selected(path) && this.has(path)
    if (!this.paths.some(selected)) return
    await retire(held)
    this.save(this.copies().filter((one) => !selected(one.path)))
    for (const record of this.registry.records())
      for (const slot of slots) {
        const paths = ((record.state[slot] ?? []) as string[]).filter(
          (path) => !selected(this.physical(record, path))
        )
        this.registry.storage(record.id).saveLocalStorage(slot, paths)
      }
    this.refresh()
  }
}
