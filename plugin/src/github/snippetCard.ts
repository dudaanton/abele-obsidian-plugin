/**
 * The card an `abele-github` block is drawn as, in Reading view and Live Preview alike. It is
 * registered whether or not the GitHub integration is on: the block is the note's, and the code
 * in it reads without GitHub.
 */
import { MarkdownRenderChild, type MarkdownPostProcessorContext } from 'obsidian'
import { createApp, h } from 'vue'
import GithubSnippet from '@/components/github/GithubSnippet.vue'
import { SNIPPET_BLOCK, parseSnippet } from './snippetBlock'

class SnippetChild extends MarkdownRenderChild {
  constructor(
    el: HTMLElement,
    private readonly dispose: () => void
  ) {
    super(el)
  }

  onunload(): void {
    this.dispose()
  }
}

export function registerSnippetBlock(
  register: (
    language: string,
    handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void
  ) => void
): void {
  register(SNIPPET_BLOCK, (source, el, ctx) => {
    const snippet = parseSnippet(source)
    const host = el.createDiv()
    const app = createApp({
      render: () => h(GithubSnippet, { snippet, source, filePath: ctx.sourcePath }),
    })
    app.mount(host)
    ctx.addChild(new SnippetChild(host, () => app.unmount()))
  })
}
