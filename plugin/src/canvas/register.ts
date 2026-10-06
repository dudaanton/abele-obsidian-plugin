import { ViewPlugin } from '@codemirror/view'
import { editorInfoField, Notice, TFile, TFolder, type Plugin } from 'obsidian'
import { AbeleConfig } from '../services/AbeleConfig'
import { CanvasView } from './CanvasView'
import { adoptCanvasLeaves, CANVAS_VIEW_TYPE, openCanvas } from './opening'
import { canvasEmbedProcessor, canvasEmbedsInEditor } from './embed'
import { canvasDocuments } from './documentRegistry'
import { newCanvas } from './editorControls'
import './viewer.css'

export function registerCanvas(plugin: Plugin): void {
  const { app } = plugin
  canvasDocuments(app).registerLifecycle(plugin)
  plugin.registerView(CANVAS_VIEW_TYPE, (leaf) => new CanvasView(leaf))
  let pending = 0,
    adopting = false
  const adopt = () => {
    window.clearTimeout(pending)
    pending = window.setTimeout(() => {
      if (!AbeleConfig.getInstance().canvasViewer) return
      // A save/layout event during a slow read still needs a pass after that read.
      if (adopting) {
        adopt()
        return
      }
      adopting = true
      void adoptCanvasLeaves(app)
        .catch((error) => new Notice(`Could not open diagram: ${String(error)}`))
        .finally(() => {
          adopting = false
        })
    }, 40)
  }
  app.workspace.onLayoutReady(adopt)
  plugin.registerEvent(app.workspace.on('file-open', adopt))
  plugin.registerEvent(app.workspace.on('layout-change', adopt))
  plugin.registerEvent(
    app.vault.on('modify', (file) => {
      if (file instanceof TFile && file.extension === 'canvas') adopt()
    })
  )
  plugin.register(() => window.clearTimeout(pending))
  plugin.registerMarkdownPostProcessor(canvasEmbedProcessor(app))
  plugin.registerEditorExtension(
    ViewPlugin.define(
      canvasEmbedsInEditor(
        app,
        (view) => view.state.field(editorInfoField, false)?.file?.path ?? ''
      )
    )
  )
  plugin.registerEvent(
    app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || file.extension !== 'canvas') return
      menu.addItem((item) =>
        item
          .setTitle('Open in Abele')
          .setIcon('workflow')
          .onClick(() => void openCanvas(app, file))
      )
    })
  )
  plugin.addCommand({
    id: 'new-canvas',
    name: 'New canvas',
    icon: 'workflow',
    callback: () => void newCanvas(app),
  })
  plugin.registerEvent(
    app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFolder)
        menu.addItem((item) =>
          item
            .setTitle('New Abele canvas')
            .setIcon('workflow')
            .onClick(() => void newCanvas(app, file))
        )
    })
  )
  plugin.addCommand({
    id: 'open-canvas-viewer',
    name: 'Open current canvas in diagram viewer',
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile()
      if (file?.extension !== 'canvas') return false
      if (!checking) void openCanvas(app, file)
      return true
    },
  })
}
