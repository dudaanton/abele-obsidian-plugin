/**
 * The one store of book places for the plugin, in `book-places.json` beside its settings, with
 * `book-places.backup.json` written just before it.
 */
import type { Plugin } from 'obsidian'
import { BookPlaces, type PlaceCopy } from './positions'

let places: BookPlaces | null = null

export function initBookPlaces(plugin: Plugin): BookPlaces {
  const adapter = plugin.app.vault.adapter
  const dir = plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/abele`
  const pathOf = (copy: PlaceCopy) => `${dir}/book-places${copy === 'backup' ? '.backup' : ''}.json`
  places = new BookPlaces({
    read: async (copy) =>
      (await adapter.exists(pathOf(copy))) ? adapter.read(pathOf(copy)) : null,
    write: (data, copy) => adapter.write(pathOf(copy), data),
  })
  return places
}

/** The store, once the plugin has loaded; null before, and in tests that do not make one. */
export const bookPlaces = (): BookPlaces | null => places
