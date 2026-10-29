/**
 * The card an `abele-github` block is drawn as, in Reading view and Live Preview alike. It is
 * registered whether or not the GitHub integration is on: the block is the note's, and the code
 * in it reads without GitHub.
 */
import { MarkdownRenderChild, type MarkdownPostProcessorContext } from 'obsidian'
import { h } from 'vue'
import GithubSnippet from '@/components/github/GithubSnippet.vue'
import { mountKit } from '@/components/obsidian/mount'
import { SNIPPET_BLOCK, FORGE_SNIPPET_BLOCK, parseSnippet } from './snippetBlock'
import { isPrintMode } from '@/markdown/printMode'

export function registerSnippetBlock(
  register: (
    language: string,
    handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void
  ) => void
): void {
  registerBlock(register, SNIPPET_BLOCK)
}
export function registerForgeSnippetBlock(
  register: Parameters<typeof registerSnippetBlock>[0]
): void {
  registerBlock(register, FORGE_SNIPPET_BLOCK)
}
function registerBlock(
  register: Parameters<typeof registerSnippetBlock>[0],
  language: string
): void {
  register(language, (source, el, ctx) => {
    const snippet = parseSnippet(source)
    if (snippet && snippet.kind !== 'comment' && isPrintMode(el)) {
      const card = el.createDiv({ cls: 'abele-github-snippet' })
      card.createDiv({ text: snippet.label })
      card.createEl('pre').createEl('code', { text: snippet.text })
      return
    }
    const host = el.createDiv()
    const child = new MarkdownRenderChild(host)
    mountKit(
      host,
      { render: () => h(GithubSnippet, { snippet, source, filePath: ctx.sourcePath }) },
      null,
      { owner: child }
    )
    ctx.addChild(child)
  })
}
