/**
 * The one store of book places for the plugin, in `book-places.json` beside its settings.
 */
import type { Plugin } from 'obsidian'
import { BookPlaces } from './positions'

let places: BookPlaces | null = null

export function initBookPlaces(plugin: Plugin): BookPlaces {
  const adapter = plugin.app.vault.adapter
  const path = `${plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/abele`}/book-places.json`
  places = new BookPlaces({
    read: async () => ((await adapter.exists(path)) ? adapter.read(path) : null),
    write: (data) => adapter.write(path, data),
  })
  return places
}

/** The store, once the plugin has loaded; null before, and in tests that do not make one. */
export const bookPlaces = (): BookPlaces | null => places
