import type { App } from 'obsidian'
import { durableHostOf } from '../hostSyncStorage'
import { ExternalRecoveryRequired } from './recovery'
import type { InspectionEntry } from './inspectionIdentity'
import { EXTERNAL_INSPECTION_KEY, inspectionSchema } from './inspectionSchema'

const entrySchema = inspectionSchema.shape.entries.element

/** Where the projection classification cache lives. A large vault's cache does not fit the
 * host's local-storage quota, and the host drops an oversized value without an error, so the
 * cache is kept in the sync host database whenever one is open. Local storage remains only
 * for hosts without it. */
export interface InspectionCache {
  readonly storage: 'host' | 'local'
  load(): Promise<InspectionEntry[]>
  /** Writes the given rows and removes retired paths; other paths are left as they are. */
  save(entries: readonly InspectionEntry[], retired?: readonly string[]): Promise<void>
}

const valid = (values: readonly unknown[]): InspectionEntry[] =>
  values.flatMap((value) => {
    const row = entrySchema.safeParse(value)
    return row.success ? [row.data] : []
  })

function legacy(app: App): InspectionEntry[] | null {
  const cached = inspectionSchema.safeParse(app.loadLocalStorage(EXTERNAL_INSPECTION_KEY))
  return cached.success ? cached.data.entries : null
}

export function inspectionCache(app: App): InspectionCache {
  const host = durableHostOf(app)
  if (host && !host.isClosed)
    return {
      storage: 'host',
      async load() {
        const rows = valid(await host.readInspections())
        // An earlier version kept the cache in local storage. Move what it holds, then free it.
        const earlier = legacy(app)
        if (earlier) {
          const known = new Set(rows.map((row) => row.path))
          const moved = earlier.filter((row) => !known.has(row.path))
          await host.writeInspections(moved)
          rows.push(...moved)
        }
        if (app.loadLocalStorage(EXTERNAL_INSPECTION_KEY) != null)
          app.saveLocalStorage(EXTERNAL_INSPECTION_KEY, null)
        return rows
      },
      save: (entries, retired = []) => host.writeInspections(entries, retired),
    }
  return {
    storage: 'local',
    load: async () => legacy(app) ?? [],
    async save(entries, retired = []) {
      // Connections share the vault cache. Keep another scope's completed inspections.
      const merged = new Map((legacy(app) ?? []).map((entry) => [entry.path, entry] as const))
      for (const entry of entries) merged.set(entry.path, entry)
      for (const path of retired) merged.delete(path)
      const value = { schema: 1, entries: [...merged.values()] }
      app.saveLocalStorage(EXTERNAL_INSPECTION_KEY, value)
      if (JSON.stringify(app.loadLocalStorage(EXTERNAL_INSPECTION_KEY)) !== JSON.stringify(value))
        throw new ExternalRecoveryRequired('inspection cache was not persisted')
    },
  }
}
