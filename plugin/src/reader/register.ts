/**
 * The book reader's hooks into Obsidian: the tab type, and `.epub` files opening in it.
 *
 * Another plugin may already have claimed `.epub`; Obsidian then refuses a second claim, and the
 * books keep opening where they did before rather than the plugin failing to load.
 */
import type { Plugin } from 'obsidian'
import { TFile } from 'obsidian'
import { BOOK_EXTENSIONS, BOOK_VIEW_TYPE, BookView } from './BookView'
import { initBookPlaces } from './places'

export function registerReader(plugin: Plugin): void {
  const places = initBookPlaces(plugin)
  plugin.registerView(BOOK_VIEW_TYPE, (leaf) => new BookView(leaf))
  // The last page turned is written a moment later; quitting or unloading writes it now.
  plugin.registerEvent(plugin.app.workspace.on('quit', () => void places.flush()))
  plugin.register(() => void places.flush())
  // A book kept by its path follows the file when it is renamed or moved.
  plugin.registerEvent(
    plugin.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFile && BOOK_EXTENSIONS.includes(file.extension))
        void places.renamed(oldPath, file.path)
    })
  )
  try {
    plugin.registerExtensions(BOOK_EXTENSIONS, BOOK_VIEW_TYPE)
  } catch (e) {
    console.warn('[Abele] .epub is already handled by another plugin; the book reader stays off', e)
  }
}
