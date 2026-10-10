/**
 * The book reader's hooks into Obsidian: the tab type, `.epub` files opening in it, "Open in
 * Abele reader" in a file's menu, and — unless the setting is off — `.pdf` files opening in it.
 *
 * Another plugin may already have claimed `.epub`; Obsidian then refuses a second claim, and the
 * books keep opening where they did before rather than the plugin failing to load.
 */
import { Notice, TFile, type Plugin } from 'obsidian'
import { watch } from 'vue'
import { settingsSlice } from '@/composables/settingsSlice'
import { AbeleConfig } from '@/services/AbeleConfig'
import { BOOK_EXTENSIONS, BOOK_VIEW_TYPE, BookView, READER_EXTENSIONS } from './BookView'
import { initBookPlaces } from './places'
import { initBookBookmarks } from './bookmarkFiles'
import { fontsFolderOf, renamedBookNotes } from './settings'
import { currentReaderSettings } from './currentSettings'
import { ReaderFonts, initReaderFonts } from './readerFonts'
import { adoptPdfLeaves, setPdfTakeover } from './pdfTakeover'
import { registerPlaceLinks } from './placeLinks'
import { registerFormsLinks } from './vocab/formsLinks'
import { reuseBookTabs } from './bookTabReuse'
import { forgetBookTexts } from './bookText'
import { moveInk } from './ink/inkStore'
import { EINK_BODY_CLASS, eink, followEink, initEink, setEink } from './eink'
import { initZen, setZen, zen } from './zen'

export function registerReader(plugin: Plugin): void {
  const { app } = plugin
  const places = initBookPlaces(plugin)
  const bookmarks = initBookBookmarks(plugin)
  // E-ink mode is this device's own choice, kept on it (`eink.ts`).
  initEink(app)
  // The quick button floats over a book from outside its tab: it holds still by the body's class.
  const stopBody = followEink(document.body, () => {}, EINK_BODY_CLASS)
  plugin.register(() => {
    stopBody()
    document.body.classList.remove(EINK_BODY_CLASS)
  })
  plugin.addCommand({
    id: 'reader-toggle-eink',
    name: 'Toggle e-ink mode for books on this device',
    callback: () => {
      setEink({ on: !eink().on })
      new Notice(eink().on ? 'E-ink mode is on for books on this device.' : 'E-ink mode is off.')
    },
  })
  // Zen mode, the device's own choice too (`zen.ts`).
  initZen(app)
  plugin.addCommand({
    id: 'reader-toggle-zen',
    name: 'Toggle zen mode for books on this device',
    callback: () => setZen(!zen().on),
  })
  // The fonts folder: read when a book or the settings first ask, followed from then on.
  const fonts = new ReaderFonts(app.vault, () => fontsFolderOf(currentReaderSettings()))
  initReaderFonts(fonts)
  plugin.register(fonts.start())
  plugin.register(
    watch(
      settingsSlice(() => fontsFolderOf(currentReaderSettings())),
      () => fonts.folderChanged()
    )
  )
  plugin.register(() => initReaderFonts(null))
  plugin.registerView(BOOK_VIEW_TYPE, (leaf) => new BookView(leaf))
  // The last page turned is written a moment later; quitting or unloading writes it now.
  plugin.registerEvent(app.workspace.on('quit', () => void places.flush()))
  // A phone may stop the app in the background without it ever hearing that it quits.
  plugin.register(places.flushWhenHidden(window))
  plugin.registerEvent(app.workspace.on('quit', () => void bookmarks.flush()))
  plugin.register(bookmarks.flushWhenHidden(window))
  plugin.register(() => {
    void places.flush()
    void bookmarks.flush()
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
      void bookmarks.renamed(oldPath, file.path)
      // A PDF's ink goes with it.
      if (file.extension === 'pdf') void moveInk(app, oldPath, file.path)
      // Its own choice of where its highlights go, too.
      const config = AbeleConfig.getInstance()
      const reader = currentReaderSettings()
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
  // A highlight's forms in its note, a link to every place they stand in the book.
  registerFormsLinks(plugin)
  // A link to a book already open goes to its tab.
  plugin.register(reuseBookTabs(app))

  // PDFs open in the reader while the setting says so — those already open in Obsidian's viewer,
  // tabs brought back from the last session among them, move over as it takes effect.
  let taken = false
  const apply = () => {
    const on = currentReaderSettings().pdfInReader
    if (!setPdfTakeover(app, on, BOOK_VIEW_TYPE)) return
    if (on && !taken) void adoptPdfLeaves(app, BOOK_VIEW_TYPE)
    taken = on
  }
  app.workspace.onLayoutReady(apply)
  const stop = watch(
    settingsSlice(() => currentReaderSettings().pdfInReader),
    apply
  )
  plugin.register(() => {
    stop()
    setPdfTakeover(app, false, BOOK_VIEW_TYPE)
  })
}
