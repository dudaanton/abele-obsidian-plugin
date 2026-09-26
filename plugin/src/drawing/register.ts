/**
 * The drawing's hooks into Obsidian: its tab, drawings opening in it, the ways to make one, and
 * drawings shown in notes.
 */
import { TFile, TFolder, type Editor, type MarkdownView, type Plugin } from 'obsidian'
import { DRAWING_VIEW_TYPE, DrawingView } from './DrawingView'
import {
  adoptDrawingLeaves,
  copyEmbed,
  insertDrawing,
  isDrawingFile,
  known,
  newDrawing,
} from './files'
import { drawingEmbedProcessor } from './embed'

export function registerDrawing(plugin: Plugin): void {
  const { app } = plugin
  plugin.registerView(DRAWING_VIEW_TYPE, (leaf) => new DrawingView(leaf))

  let pending = 0
  const adopt = () => {
    window.clearTimeout(pending)
    pending = window.setTimeout((): void => void adoptDrawingLeaves(app), 30)
  }
  app.workspace.onLayoutReady(adopt)
  plugin.registerEvent(app.workspace.on('file-open', adopt))
  plugin.registerEvent(app.workspace.on('layout-change', adopt))
  plugin.register(() => window.clearTimeout(pending))
  plugin.registerEvent(app.vault.on('delete', (file) => known.delete(file.path)))

  // A drawing's callout in a note shows the part of it the callout names.
  plugin.registerMarkdownPostProcessor(drawingEmbedProcessor(app))

  plugin.addCommand({
    id: 'new-drawing',
    name: 'New drawing',
    icon: 'pen-line',
    callback: () => void newDrawing(app),
  })

  const insertHere = (editor: Editor, view: MarkdownView) => {
    if (view.file) void insertDrawing(app, view.file, (text) => editor.replaceSelection(text))
  }
  plugin.addCommand({
    id: 'insert-drawing',
    name: 'Insert a new drawing',
    icon: 'pen-line',
    editorCallback: (editor, view) => insertHere(editor, view as MarkdownView),
  })
  plugin.registerEvent(
    app.workspace.on('editor-menu', (menu, editor, view) => {
      menu.addItem((item) =>
        item
          .setTitle('Insert a new drawing')
          .setIcon('pen-line')
          .setSection('insert')
          .onClick(() => insertHere(editor, view as MarkdownView))
      )
    })
  )

  plugin.registerEvent(
    app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFolder) {
        menu.addItem((item) =>
          item
            .setTitle('New drawing')
            .setIcon('pen-line')
            .setSection('action-primary')
            .onClick(() => void newDrawing(app, file))
        )
        return
      }
      if (!(file instanceof TFile) || file.extension !== 'svg') return
      const known = isDrawingFileNow(file)
      if (!known) return
      menu.addItem((item) =>
        item
          .setTitle('Copy embed for a note')
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
