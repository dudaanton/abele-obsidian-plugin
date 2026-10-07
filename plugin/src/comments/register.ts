import { MarkdownView, Notice, TFile, TFolder, type TAbstractFile, type Plugin } from 'obsidian'
import { watch } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { anchorFor } from '@/editor/commentMarkers'
import { setTextCommentClickHandler, setTextCommentInfoSource } from '@/editor/CommentPlugin'
import { TextComments } from './TextComments'
import { noteCommentPostProcessor, selectedReadingComment } from './reading'
import type { CommentSelection } from './service'

export function captureCommentSelection(view: MarkdownView): CommentSelection | null {
  if (view.file?.extension !== 'md') return null
  if (view.getMode() === 'preview') {
    const selection = view.contentEl.ownerDocument.defaultView?.getSelection()
    if (!selection?.rangeCount || selection.isCollapsed) return null
    return selectedReadingComment(view.contentEl, selection.getRangeAt(0).cloneRange())
  }
  const editor = view.editor
  if (!editor.getSelection().trim()) return null
  const source = editor.getValue()
  const from = editor.posToOffset(editor.getCursor('from'))
  const end = editor.posToOffset(editor.getCursor('to'))
  const anchor = anchorFor(source, end)
  if (!anchor) return null
  return { note: view.file.path, source, from, to: anchor.pos }
}

/** Registered even when every AI feature is disabled. */
export function registerTextComments(plugin: Plugin): TextComments {
  const comments = new TextComments(plugin.app)
  setTextCommentInfoSource(comments)
  setTextCommentClickHandler((ids) => {
    void comments.open(ids)
  })
  plugin.register(() => {
    comments.destroy()
    setTextCommentInfoSource({ get: () => undefined, touch: () => {} })
    setTextCommentClickHandler(() => {})
  })
  plugin.registerMarkdownPostProcessor(noteCommentPostProcessor)
  const add = (view: MarkdownView, selection: CommentSelection) => {
    void comments
      .add(selection, async () => {
        if (view.file?.path !== selection.note)
          throw new Error('The note moved or was closed. Select the passage again')
        await view.save()
      })
      .catch((error) => new Notice(error instanceof Error ? error.message : String(error)))
  }
  plugin.addCommand({
    id: 'add-text-comment',
    name: 'Add comment',
    icon: 'message-square',
    checkCallback: (checking) => {
      const view = plugin.app.workspace.getActiveViewOfType(MarkdownView)
      const selection = view ? captureCommentSelection(view) : null
      if (!view || !selection) return false
      if (!checking) add(view, selection)
      return true
    },
  })
  plugin.registerEvent(
    plugin.app.workspace.on('editor-menu', (menu, _editor, info) => {
      if (!(info instanceof MarkdownView)) return
      const selection = captureCommentSelection(info)
      if (!selection) return
      menu.addItem((item) =>
        item
          .setTitle('Add comment')
          .setIcon('message-square')
          .onClick(() => add(info, selection))
      )
    })
  )
  const fileChanged = (file: TAbstractFile) => {
    if (file instanceof TFile && file.extension === 'abcomment') comments.invalidate(file.basename)
  }
  plugin.registerEvent(plugin.app.vault.on('create', fileChanged))
  plugin.registerEvent(plugin.app.vault.on('modify', fileChanged))
  plugin.registerEvent(plugin.app.vault.on('delete', fileChanged))
  plugin.registerEvent(
    plugin.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFolder || (file instanceof TFile && file.extension === 'md')) {
        comments.followRename(oldPath, file.path)
        void comments.service
          .rename(oldPath, file.path)
          .finally(() => comments.invalidate())
          .catch(
            (error) =>
              new Notice(
                `Could not update text comment anchors: ${error instanceof Error ? error.message : String(error)}`
              )
          )
      } else if (file instanceof TFile && file.extension === 'abcomment') comments.invalidate()
    })
  )
  plugin.registerEvent(
    plugin.app.workspace.on('file-open', (file) => {
      if (file?.extension === 'abcomment' && file.path === comments.repository.path(file.basename))
        void comments.open([file.basename])
    })
  )
  plugin.register(
    watch(
      () => AbeleConfig.getInstance().ai.commentFolder,
      () => comments.invalidate()
    )
  )
  return comments
}
