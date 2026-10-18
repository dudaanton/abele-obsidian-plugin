import { t } from '@/i18n'
/** Picture editing and read-only legacy drawing compatibility. */
import { ViewPlugin } from '@codemirror/view'
import { Platform, TFile, editorInfoField, type Plugin } from 'obsidian'
import { DRAWING_VIEW_TYPE, DrawingView } from './DrawingView'
import { DRAWABLE_PICTURES, IMAGE_INK_VIEW_TYPE, ImageInkView } from './ImageInkView'
import { copyEmbed, openImageInk, isDrawingFile, known } from './files'
import { drawingEmbedProcessor, drawingEmbedsInEditor } from './embed'
import { registerDrawingConversion } from './conversionCommand'
import {
  DRAW_ON_PICTURE,
  PenOnPictureTabs,
  PictureEmbedMenus,
  type PictureTab,
} from './pictureEntries'

export function registerDrawing(plugin: Plugin): void {
  const { app } = plugin
  plugin.registerView(DRAWING_VIEW_TYPE, (leaf) => new DrawingView(leaf))
  plugin.registerView(IMAGE_INK_VIEW_TYPE, (leaf) => new ImageInkView(leaf))

  registerDrawingConversion(plugin)
  plugin.registerEvent(app.vault.on('delete', (file) => known.delete(file.path)))

  // A drawing's callout in a note shows the part of it the callout names.
  plugin.registerMarkdownPostProcessor(drawingEmbedProcessor(app))
  // A drawing embedded the plain way in live preview, which Obsidian draws outside any rendering.
  plugin.registerEditorExtension(
    ViewPlugin.define(
      drawingEmbedsInEditor(
        app,
        (view) => view.state.field(editorInfoField, false)?.file?.path ?? ''
      )
    )
  )

  // Drawing begun where a picture is looked at: a pen in the header of Obsidian's own picture
  // tab, and the menu of a picture embedded in a note.
  const pens = new PenOnPictureTabs(
    () => app.workspace.getLeavesOfType('image').map((leaf) => leaf.view as unknown as PictureTab),
    (path) => void openImageInk(app, path)
  )
  app.workspace.onLayoutReady(() => pens.sync())
  plugin.registerEvent(app.workspace.on('layout-change', () => pens.sync()))
  plugin.registerEvent(app.workspace.on('file-open', () => pens.sync()))
  plugin.register(() => pens.stop())
  const embeds = new PictureEmbedMenus(
    app,
    (path, anchor) => void openImageInk(app, path, '', anchor)
  )
  plugin.registerMarkdownPostProcessor(embeds.remember)
  const listen = (doc: Document) => {
    plugin.registerDomEvent(doc, 'contextmenu', embeds.onContextMenu, { capture: true })
    if (!Platform.isMobile) return
    plugin.registerDomEvent(doc, 'touchstart', embeds.onTouchStart, {
      capture: true,
      passive: true,
    })
    plugin.registerDomEvent(doc, 'touchmove', embeds.onTouchMove, { capture: true, passive: true })
    plugin.registerDomEvent(doc, 'touchend', embeds.onTouchEnd, { capture: true, passive: false })
    plugin.registerDomEvent(doc, 'touchcancel', embeds.onTouchEnd, { capture: true })
  }
  listen(document)
  plugin.registerEvent(app.workspace.on('window-open', (_win, win) => listen(win.document)))

  plugin.registerEvent(
    app.workspace.on('file-menu', (menu, file, source) => {
      if (file instanceof TFile && DRAWABLE_PICTURES.includes(file.extension.toLowerCase())) {
        // Opened on a picture embedded in a note: the embed it was, to save back in its place.
        const anchor = source === 'link-context-menu' ? embeds.take(file.path) : null
        menu.addItem((item) =>
          item
            .setTitle(DRAW_ON_PICTURE)
            .setIcon('pen-line')
            .setSection('action')
            .onClick(() => void openImageInk(app, file.path, '', anchor))
        )
        return
      }
      if (!(file instanceof TFile) || file.extension !== 'svg') return
      const known = isDrawingFileNow(file)
      if (!known) return
      menu.addItem((item) =>
        item
          .setTitle(t('streamC.7210a6fd0179a92e'))
          .setIcon('clipboard-copy')
          .setSection('action')
          .onClick(() => void copyEmbed(`![[${file.path}]]`))
      )
    })
  )
  // What the menu above asks is known by the time a menu opens: every drawing seen is.
  const isDrawingFileNow = (file: TFile) => known.get(file.path)?.drawing ?? false
  plugin.registerEvent(
    app.vault.on('modify', (file) => {
      if (file instanceof TFile && file.extension === 'svg') void isDrawingFile(app, file)
    })
  )
}
