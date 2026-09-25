/**
 * The one store of bookmarks for the plugin: a JSON file in the vault beside the book places'
 * (`abele-book-bookmarks.json`, in the folder the places file is set to), so they reach the other
 * devices the way the places do. `book-bookmarks.backup.json`, in the plugin's own folder, is
 * written just before it, on this device only.
 *
 * The file changing on disk — another device's bookmarks arriving — is heard; the places file
 * set to another folder takes the bookmarks along.
 */
import { Notice, normalizePath, TFile, type Plugin } from 'obsidian'
import { watch } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { BookBookmarks, type BookmarkStorage } from './bookmarks'
import { MOVE_AFTER_MS, type PlacesAdapter } from './places'
import { placesPathOf, readerSettingsFrom, type ReaderSettings } from './settings'

export const BOOKMARKS_FILE = 'abele-book-bookmarks.json'

/** The bookmarks file: beside the places file, whatever that is called. */
export function bookmarksPathOf(settings: ReaderSettings): string {
  const places = placesPathOf(settings)
  const slash = places.lastIndexOf('/')
  return slash < 0 ? BOOKMARKS_FILE : `${places.slice(0, slash)}/${BOOKMARKS_FILE}`
}

/** The bookmarks kept at `path` in the vault, with this device's backup in `dir`. */
export function bookmarkFiles(adapter: PlacesAdapter, dir: string, path: string): BookmarkStorage {
  const backup = `${dir}/book-bookmarks.backup.json`
  const readIf = async (file: string) => ((await adapter.exists(file)) ? adapter.read(file) : null)
  return {
    read: (copy) => readIf(copy === 'backup' ? backup : path),
    write: async (data, copy) => {
      if (copy === 'backup') return adapter.write(backup, data)
      const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      if (folder && !(await adapter.exists(folder))) await adapter.mkdir(folder)
      await adapter.write(path, data)
    },
  }
}

let bookmarks: BookBookmarks | null = null

export function initBookBookmarks(plugin: Plugin): BookBookmarks {
  const { vault } = plugin.app
  const dir = plugin.manifest.dir ?? `${vault.configDir}/plugins/abele`
  const pathNow = () =>
    normalizePath(bookmarksPathOf(readerSettingsFrom(AbeleConfig.getInstance().reader)))
  let path = pathNow()
  const store = new BookBookmarks(bookmarkFiles(vault.adapter, dir, path))
  bookmarks = store

  const heard = (file: unknown) => {
    if (file instanceof TFile && file.path === path) void store.refresh()
  }
  plugin.registerEvent(vault.on('modify', heard))
  plugin.registerEvent(vault.on('create', heard))

  const move = async () => {
    const next = pathNow()
    if (next === path) return
    const old = path
    if (!(await store.moveTo(bookmarkFiles(vault.adapter, dir, next)))) {
      new Notice(`Bookmarks stay in ${old}: ${next} holds something else.`)
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
    bookmarks = null
  })
  return store
}

/** The store, once the plugin has loaded; null before, and in tests that do not make one. */
export const bookBookmarks = (): BookBookmarks | null => bookmarks
