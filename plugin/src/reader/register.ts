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
import { readerSettingsFrom, renamedBookNotes } from './settings'
import { setPdfTakeover } from './pdfTakeover'
import { registerPlaceLinks } from './placeLinks'
import { forgetBookTexts } from './bookText'

export function registerReader(plugin: Plugin): void {
  const { app } = plugin
  const places = initBookPlaces(plugin)
  plugin.registerView(BOOK_VIEW_TYPE, (leaf) => new BookView(leaf))
  // The last page turned is written a moment later; quitting or unloading writes it now.
  plugin.registerEvent(app.workspace.on('quit', () => void places.flush()))
  // A phone may stop the app in the background without it ever hearing that it quits.
  plugin.register(places.flushWhenHidden(window))
  plugin.register(() => {
    void places.flush()
    forgetBookTexts()
  })
  // One at a time: an extension another plugin already has stays with it, the rest come here.
  for (const extension of BOOK_EXTENSIONS)
    try {
      plugin.registerExtensions([extension], BOOK_VIEW_TYPE)
    } catch (e) {
      console.warn(`[Abele] .${extension} is already handled by another plugin; it stays there`, e)
    }

  // A book kept by its path follows the file when it is renamed or moved.
  plugin.registerEvent(
    app.vault.on('rename', (file, oldPath) => {
      if (!(file instanceof TFile) || !READER_EXTENSIONS.includes(file.extension)) return
      void places.renamed(oldPath, file.path)
      // Its own choice of where its highlights go, too.
      const config = AbeleConfig.getInstance()
      const reader = readerSettingsFrom(config.reader)
      const moved = renamedBookNotes(reader.bookNotes, oldPath, file.path)
      if (!moved) return
      config.reader = { ...reader, bookNotes: moved }
      void config.saveSettings()
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

  // A link to a place in a PDF's text opens here, where the place is understood.
  registerPlaceLinks(plugin, BOOK_VIEW_TYPE)

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
