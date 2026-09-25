/**
 * The one store of book places for the plugin. The places are a JSON file in the vault — the path
 * is a reader setting, `abele-book-places.json` at the root by default — so they reach the other
 * devices the way the rest of the vault does: Obsidian Sync carries of a plugin's folder only its
 * code and its settings, and places kept there never left the device.
 *
 * `book-places.backup.json`, in the plugin's own folder, is written just before the file, on
 * this device only: a write cut short leaves one whole copy. `book-places.json` there is where
 * the places were kept before; its places are folded into the vault's file once, and it goes.
 *
 * The file changing on disk — another device's places arriving — is heard, and a newer place
 * taken; the path set anew moves the places to the new file.
 */
import { Notice, normalizePath, TFile, type Plugin } from 'obsidian'
import { watch } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { BookPlaces, type PlaceStorage } from './positions'
import { placesPathOf, readerSettingsFrom } from './settings'

/** What of Obsidian's file adapter the places need. */
export interface PlacesAdapter {
  exists(path: string): Promise<boolean>
  read(path: string): Promise<string>
  write(path: string, data: string): Promise<void>
  mkdir(path: string): Promise<void>
  remove(path: string): Promise<void>
}

/** How long the path setting rests before the places move: it is typed a letter at a time. */
export const MOVE_AFTER_MS = 1000

/** The places kept at `path` in the vault, with this device's backup and old copy in `dir`. */
export function placeFiles(adapter: PlacesAdapter, dir: string, path: string): PlaceStorage {
  const backup = `${dir}/book-places.backup.json`
  const legacy = `${dir}/book-places.json`
  const readIf = async (file: string) => ((await adapter.exists(file)) ? adapter.read(file) : null)
  return {
    read: (copy) => readIf(copy === 'backup' ? backup : path),
    write: async (data, copy) => {
      if (copy === 'backup') return adapter.write(backup, data)
      const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      if (folder && !(await adapter.exists(folder))) await adapter.mkdir(folder)
      await adapter.write(path, data)
    },
    legacy: async () => [await readIf(legacy)],
    dropLegacy: async () => {
      if (await adapter.exists(legacy)) await adapter.remove(legacy)
    },
  }
}

let places: BookPlaces | null = null

export function initBookPlaces(plugin: Plugin): BookPlaces {
  const { vault } = plugin.app
  const dir = plugin.manifest.dir ?? `${vault.configDir}/plugins/abele`
  const pathNow = () =>
    normalizePath(placesPathOf(readerSettingsFrom(AbeleConfig.getInstance().reader)))
  let path = pathNow()
  const store = new BookPlaces(placeFiles(vault.adapter, dir, path))
  places = store

  // The file changed on disk — synced from another device — or appeared there.
  const heard = (file: unknown) => {
    if (file instanceof TFile && file.path === path) void store.refresh()
  }
  plugin.registerEvent(vault.on('modify', heard))
  plugin.registerEvent(vault.on('create', heard))

  // The path set anew: the places go to the new file, and the old one goes once they are there.
  const move = async () => {
    const next = pathNow()
    if (next === path) return
    const old = path
    if (!(await store.moveTo(placeFiles(vault.adapter, dir, next)))) {
      new Notice(`Book places stay in ${old}: ${next} holds something else.`)
      return
    }
    path = next
    await vault.adapter.remove(old).catch((): void => {})
  }
  let timer = 0
  const stop = watch(AbeleConfig.getInstance().version, () => {
    window.clearTimeout(timer)
    timer = window.setTimeout((): void => void move(), MOVE_AFTER_MS)
  })
  plugin.register(() => {
    stop()
    window.clearTimeout(timer)
  })
  return store
}

/**
 * An open book following its place as another device moves it on: a newer place arriving goes to
 * it, and says so. Returns what stops it.
 */
export function followPlace(
  key: string,
  current: () => string | undefined,
  go: (cfi: string) => Promise<unknown>
): () => void {
  const store = places
  if (!store) return () => {}
  return store.onNewer((keys) => {
    if (!keys.includes(key)) return
    void store.get(key).then(async (place) => {
      if (!place || place.cfi === current()) return
      await go(place.cfi)
      new Notice('Moved to where this book was left on another device.')
    })
  })
}

/** The store, once the plugin has loaded; null before, and in tests that do not make one. */
export const bookPlaces = (): BookPlaces | null => places
