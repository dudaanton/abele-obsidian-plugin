import { EditorView, ViewPlugin } from '@codemirror/view'
import { Extension } from '@codemirror/state'
import { editorInfoField, TFile } from 'obsidian'
import { HeaderWidget } from './HeaderWidget'
import { TaskHeaderWidget } from './TaskHeaderWidget'
import { GlobalStore } from '@/stores/GlobalStore'
import { isNestedEditor } from '@/helpers/editorHelpers'
import { isTaskType } from '@/helpers/taskType'

export function createHeaderExtension(registerCleanup?: (cleanup: () => void) => void): Extension {
  const instances = new Set<{ destroy(): void }>()
  let disposed = false
  registerCleanup?.(() => {
    disposed = true
    for (const instance of instances) instance.destroy()
    instances.clear()
  })
  return ViewPlugin.fromClass(
    class {
      private file: TFile | null
      private noteType?: string
      private view: EditorView
      private widgetElement?: HTMLElement
      private wiget?: HeaderWidget | TaskHeaderWidget

      private destroyed = false
      private timer?: number
      private refreshAt = 0
      /** A table cell's editor: it carries the note's file, but the header is the note's alone. */
      private readonly nested: boolean

      constructor(view: EditorView) {
        // Form editors have no file, but still receive updates after construction.
        this.view = view
        this.nested = isNestedEditor(view.state)
        this.file = this.nested ? null : (view.state.field(editorInfoField)?.file ?? null)
        this.destroyed = disposed
        if (disposed) return
        instances.add(this)
        if (!this.file) return

        const cache = GlobalStore.getInstance().app.metadataCache.getFileCache(this.file)
        this.noteType = cache?.frontmatter?.type

        this.createWidget()
      }

      private createWidget() {
        if (!this.file) return

        if (isTaskType(this.noteType)) {
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
        if (this.widgetElement) this.wiget?.destroy(this.widgetElement)
        this.widgetElement = undefined
        this.wiget = undefined
      }

      update() {
        // metadata cache is not updated immediately
        if (this.nested || this.destroyed) return
        this.refreshAt = Date.now() + 300
        if (this.timer !== undefined) return
        const refresh = () => {
          this.timer = undefined
          if (this.destroyed || (this.view as unknown as { destroyed: boolean }).destroyed) return
          const remaining = this.refreshAt - Date.now()
          if (remaining > 0) {
            this.timer = window.setTimeout(refresh, remaining)
            return
          }
          // A host can detach an editor before CodeMirror calls this plugin's destroy.
          // Its state getter itself may no longer be valid, not only the metadata field.
          let state
          try {
            state = this.view.state
          } catch {
            this.destroy()
            return
          }
          if (!state) {
            this.destroy()
            return
          }
          const currentFile = state.field(editorInfoField, false)?.file ?? null

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
        }
        this.timer = window.setTimeout(refresh, 300)
      }

      destroy() {
        if (this.destroyed) return
        this.destroyed = true
        window.clearTimeout(this.timer)
        this.timer = undefined
        instances.delete(this)
        this.destroyWidget()
      }
    }
  )
}
