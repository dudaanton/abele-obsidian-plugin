import type { EventRef } from 'obsidian'
import { watch } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { taskStateField } from '@/editor/TaskPlugin'
import { galleryExtensions } from '@/editor/GalleryPlugin'
import { galleryPostProcessor } from '@/editor/galleryPostProcessor'
import { recordSignatures, SIGNATURE_PROCESSOR_ORDER } from '@/components/obsidian/markdownParts'
import { mermaidExtensions, refreshMermaidEditors } from '@/editor/MermaidPlugin'
import { editorSyntaxExtension, refreshSyntaxEditors } from '@/editor/EditorSyntax'
import { mermaidPostProcessor, MERMAID_PROCESSOR_ORDER } from '@/mermaid/mermaidBlocks'
import { footnoteExtensions } from '@/editor/FootnotePlugin'
import { highlightStateField } from '@/editor/HighlightPlugin'
import { coloredHighlightPostProcessor } from '@/editor/highlightPostProcessor'
import { commentExtensions } from '@/editor/CommentPlugin'
import { registerTextComments } from '@/comments/register'
import { createHeaderExtension } from '@/editor/HeaderExtension'
import { registerChartCodeblock } from '@/editor/ChartCodeblock'
import { registerMapCodeblock } from '@/editor/MapCodeblock'
import { registerViewCodeblock } from '@/editor/ViewCodeblock'
import { registerMessageCardBlock } from '@/ai/messageCards'
import { registerCheckboxes } from '@/checkboxes/register'
import { registerColumns } from '@/columns/register'
import { installUntrustedGuard } from '@/markdown/renderUntrusted'
import type { Plugin } from 'obsidian'
import { registerCodeIndentGuides } from '@/codeIndent/register'

/** Startup section; called at its original lifecycle position. */
export function registerEditor(plugin: Plugin) {
  registerCodeIndentGuides(plugin)
  installUntrustedGuard()
  registerCheckboxes(plugin)
  registerColumns(plugin)
  plugin.registerEditorExtension(taskStateField)
  plugin.registerEditorExtension(galleryExtensions)
  plugin.registerEditorExtension(createHeaderExtension((cleanup) => plugin.register(cleanup)))
  plugin.registerEditorExtension(footnoteExtensions)
  plugin.registerEditorExtension(highlightStateField)
  plugin.registerEditorExtension(commentExtensions)
  registerTextComments(plugin)
  const config = AbeleConfig.getInstance()
  plugin.registerEditorExtension(editorSyntaxExtension(() => config.editorSyntaxHighlight))
  plugin.register(
    watch(
      () => {
        // Saves, transfers and settings arriving from sync all increment the version.
        void config.version.value
        return config.editorSyntaxHighlight
      },
      () => refreshSyntaxEditors(plugin.app)
    )
  )
  // Reads each rendered block before anything draws into it, so a render replaced over and
  // over — a reply being streamed — keeps the blocks that came back the same.
  plugin.registerMarkdownPostProcessor(recordSignatures, SIGNATURE_PROCESSOR_ORDER)
  // The gallery outside the editor: reading mode, embeds, chat, script views.
  plugin.registerMarkdownPostProcessor(galleryPostProcessor)
  // Coloured highlights outside the editor, for the same places.
  plugin.registerMarkdownPostProcessor(coloredHighlightPostProcessor)
  // Pele diagrams drawn by the plugin's viewer: in rendered
  // markdown ahead of Obsidian's own processor, and in Live Preview as the block's widget.
  plugin.registerMarkdownPostProcessor(mermaidPostProcessor, MERMAID_PROCESSOR_ORDER)
  plugin.registerEditorExtension(mermaidExtensions())
  // Changing the drawing setting refreshes rendered markdown and open editors.
  plugin.registerEvent(
    (
      plugin.app.workspace as unknown as {
        on(name: 'post-processor-change', callback: () => void): EventRef
      }
    ).on('post-processor-change', () => refreshMermaidEditors(plugin.app))
  )

  // plugin.registerPriorityCodeblockPostProcessor(
  //   TASK_CODEBLOCK_KEYWORD,
  //   -100,
  //   async (source: string, el, ctx) => TaskRenderer.register(source, el, ctx)
  // )

  registerChartCodeblock((lang, handler) =>
    plugin.registerMarkdownCodeBlockProcessor(lang, handler)
  )

  registerMapCodeblock((lang, handler) => plugin.registerMarkdownCodeBlockProcessor(lang, handler))
  // A view an agent wrote in HTML, drawn in a frame of its own.
  registerViewCodeblock((lang, handler) => plugin.registerMarkdownCodeBlockProcessor(lang, handler))
  // A chat message kept in a note, as a card that opens the chat at it.
  registerMessageCardBlock((lang, handler) =>
    plugin.registerMarkdownCodeBlockProcessor(lang, handler)
  )
}
