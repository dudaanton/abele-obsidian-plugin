import { MarkdownRenderChild, type MarkdownPostProcessorContext } from 'obsidian'
import AgentView from '@/components/chat/AgentView.vue'
import { mountKit } from '@/components/obsidian/mount'
import { VIEW_LANGUAGE } from '@/views/agentView'
import { cleanViewHtml } from '@/views/agentView'
import { isPrintMode } from '@/markdown/printMode'

/**
 * ```abele-view``` — a view an agent wrote in HTML, in its answer or in a note it filled in. One
 * renderer for both, so a view copied from the chat into a note looks the same there.
 */
class ViewRenderChild extends MarkdownRenderChild {
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

export function registerViewCodeblock(
  registerFn: (
    language: string,
    handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void
  ) => void
): void {
  registerFn(VIEW_LANGUAGE, (source, el, ctx) => {
    if (isPrintMode(el)) {
      el.classList.add('abele-print-view')
      const parsed = new DOMParser().parseFromString(cleanViewHtml(source), 'text/html')
      el.replaceChildren(
        ...Array.from(parsed.body.childNodes).map((node) => el.ownerDocument.importNode(node, true))
      )
      return
    }
    const mounted = mountKit(el.createDiv(), AgentView, { html: source })
    ctx.addChild(new ViewRenderChild(el, mounted.unmount))
  })
}
