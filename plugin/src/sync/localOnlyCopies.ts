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
  constructor(private registry: TokenConnectionRegistry) {
    this.refresh()
  }
  private physical(record: ReturnType<TokenConnectionRegistry['records']>[number], path: string) {
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
    return (this.registry.localStorage.loadLocalStorage(LOCAL_ONLY_COPIES) ?? []) as Copy[]
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
    this.save(copies)
    for (const change of changes)
      this.registry.storage(change.id).saveLocalStorage(change.slot, change.paths)
    this.refresh()
  }
  private save(copies: Copy[]): void {
    this.registry.localStorage.saveLocalStorage(LOCAL_ONLY_COPIES, copies)
    if (
      JSON.stringify(this.registry.localStorage.loadLocalStorage(LOCAL_ONLY_COPIES)) !==
      JSON.stringify(copies)
    )
      throw new Error('Could not retain kept-copy identities')
  }
  releaseSelected(id: string, paths: string[]): void {
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
