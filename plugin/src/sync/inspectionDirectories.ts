import type { DataAdapter } from 'obsidian'
import { adapterConfigRevision } from './vaultPathLinks'

const ABSENT = Symbol.for('abele.sync.inspected-absence-v1')

/** Process-local listing evidence, never a persisted assertion about private bytes. */
export class InspectionDirectories {
  constructor(private readonly roots: readonly string[]) {}
  private readonly listings = new Map<
    string,
    {
      revision: () => number
      at: number
      entries: Set<string>
    }
  >()
  observe(adapter: DataAdapter, path: string) {
    // Revision counters are visited on every mutation. Keep their number bounded
    // by recovery ancestry rather than by the number of ordinary vault folders.
    if (path && !this.roots.some((root) => root.startsWith(path + '/'))) return () => {}
    const revision = adapterConfigRevision(adapter, path)
    const at = revision()
    return (entries: readonly string[]) => {
      if (revision() === at) this.listings.set(path, { revision, at, entries: new Set(entries) })
    }
  }
  attach(inventory: object): void {
    Reflect.set(inventory, ABSENT, (path: string) => {
      const parts = path.split('/')
      for (let i = 0; i < parts.length; i++) {
        const parent = parts.slice(0, i).join('/')
        const held = this.listings.get(parent)
        if (
          held &&
          held.revision() === held.at &&
          !held.entries.has(parts.slice(0, i + 1).join('/'))
        )
          return true
      }
      return false
    })
  }
}

export function inspectedAbsent(inventory: object | undefined, path: string): boolean {
  return inventory !== undefined && Reflect.get(inventory, ABSENT)?.(path) === true
}

/** A fresh poll can observe changes made outside the adapter wrappers. */
export function invalidateInspectedAbsence(inventory: object | undefined): void {
  if (inventory) Reflect.deleteProperty(inventory, ABSENT)
}
