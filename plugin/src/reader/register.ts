/**
 * The book reader's hooks into Obsidian: the tab type, `.epub` files opening in it, "Open in
 * Abele reader" in a file's menu, and — when the setting is on — `.pdf` files opening in it.
 *
 * Another plugin may already have claimed `.epub`; Obsidian then refuses a second claim, and the
 * books keep opening where they did before rather than the plugin failing to load.
 */
import { TFile, type Plugin } from 'obsidian'
import { watch } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { BOOK_EXTENSIONS, BOOK_VIEW_TYPE, BookView, READER_EXTENSIONS } from './BookView'
import { initBookPlaces } from './places'
import { readerSettingsFrom } from './settings'
import { setPdfTakeover } from './pdfTakeover'

export function registerReader(plugin: Plugin): void {
  const { app } = plugin
  const places = initBookPlaces(plugin)
  plugin.registerView(BOOK_VIEW_TYPE, (leaf) => new BookView(leaf))
  // The last page turned is written a moment later; quitting or unloading writes it now.
  plugin.registerEvent(app.workspace.on('quit', () => void places.flush()))
  plugin.register(() => void places.flush())
  try {
    plugin.registerExtensions(BOOK_EXTENSIONS, BOOK_VIEW_TYPE)
  } catch (e) {
    console.warn('[Abele] .epub is already handled by another plugin; the book reader stays off', e)
  }

  // A book kept by its path follows the file when it is renamed or moved.
  plugin.registerEvent(
    app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFile && READER_EXTENSIONS.includes(file.extension))
        void places.renamed(oldPath, file.path)
    })
  )

  // Any book or PDF, from its menu in the file explorer or from the tab it is open in.
  plugin.registerEvent(
    app.workspace.on('file-menu', (menu, file, source, leaf) => {
      if (!(file instanceof TFile) || !READER_EXTENSIONS.includes(file.extension)) return
      if (leaf?.view.getViewType() === BOOK_VIEW_TYPE) return
      menu.addItem((item) =>
        item
          .setTitle('Open in Abele reader')
          .setIcon('book-open')
          .setSection('open')
          .onClick(() => {
            const target = source === 'more-options' && leaf ? leaf : app.workspace.getLeaf('tab')
            void target.setViewState({
              type: BOOK_VIEW_TYPE,
              state: { file: file.path },
              active: true,
            })
          })
      )
    })
  )

  // PDFs open in the reader while the setting says so.
  const config = AbeleConfig.getInstance()
  const apply = () => setPdfTakeover(app, readerSettingsFrom(config.reader).openPdf, BOOK_VIEW_TYPE)
  app.workspace.onLayoutReady(apply)
  const stop = watch(config.version, apply)
  plugin.register(() => {
    stop()
    setPdfTakeover(app, false, BOOK_VIEW_TYPE)
  })
}
