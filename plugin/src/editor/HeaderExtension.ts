import { EditorView, ViewPlugin } from '@codemirror/view'
import { Extension } from '@codemirror/state'
import { editorInfoField, TFile } from 'obsidian'
import { HeaderWidget } from './HeaderWidget'
import { TaskHeaderWidget } from './TaskHeaderWidget'
import { GlobalStore } from '@/stores/GlobalStore'

export function createHeaderExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      private file: TFile | null
      private noteType?: string
      private view: EditorView
      private widgetElement?: HTMLElement
      private wiget?: HeaderWidget | TaskHeaderWidget

      private destroyed = false

      constructor(view: EditorView) {
        this.file = view.state.field(editorInfoField)?.file ?? null
        if (!this.file) return

        this.view = view

        const cache = GlobalStore.getInstance().app.metadataCache.getFileCache(this.file)
        this.noteType = cache?.frontmatter?.type

        this.createWidget()
      }

      private createWidget() {
        if (!this.file) return

        if (this.noteType === 'task') {
          this.wiget = new TaskHeaderWidget(this.file.path)
        } else {
          this.wiget = new HeaderWidget(this.file.path)
        }

        this.widgetElement = this.wiget.toDOM()

        const root =
          this.view.dom.closest('.cm-editor')?.parentElement ?? this.view.dom.parentElement
        const inlineTitle = root?.querySelector('.inline-title')

        if (inlineTitle && inlineTitle.parentNode) {
          inlineTitle.parentNode.insertBefore(this.widgetElement, inlineTitle.nextSibling)
        } else {
          this.view.dom.parentNode?.insertBefore(this.widgetElement, this.view.dom)
        }
      }

      private destroyWidget() {
        this.widgetElement?.remove()
        this.wiget?.destroy()
        this.widgetElement = undefined
        this.wiget = undefined
      }

      update() {
        // metadata cache is not updated immediately
        setTimeout(() => {
          if (this.destroyed) return

          const currentFile = this.view.state.field(editorInfoField)?.file ?? null

          // File changed — recreate widget for the new file
          if (currentFile?.path !== this.file?.path) {
            this.destroyWidget()
            this.file = currentFile
            if (!this.file) return
            const cache = GlobalStore.getInstance().app.metadataCache.getFileCache(this.file)
            this.noteType = cache?.frontmatter?.type
            this.createWidget()
            return
          }

          if (!this.file) return

          const cache = GlobalStore.getInstance().app.metadataCache.getFileCache(this.file)
          const noteType = cache?.frontmatter?.type

          if (noteType !== this.noteType) {
            this.noteType = noteType
            this.destroyWidget()
            this.createWidget()
          }
        }, 300)
      }

      destroy() {
        this.destroyed = true
        this.destroyWidget()
      }
    }
  )
}
