/**
 * Where the viewer takes a ```mermaid block over from Obsidian: rendered markdown — reading
 * view, embeds, callouts, and every surface of the plugin's own that renders markdown, the chat
 * and GitHub tabs among them — and Live Preview, in `src/editor/MermaidPlugin.ts`.
 *
 * Reading view is a post-processor that runs before Obsidian's own. Obsidian finds its mermaid
 * blocks as `code.language-mermaid` and draws them; this one finds them first and puts the
 * viewer where the block was, so Obsidian finds nothing and draws nothing. When the viewer is
 * switched off, or the vault has not yet been allowed to show diagrams, it leaves the block
 * where it is and Obsidian carries on as if the plugin were not there.
 */
import { MarkdownRenderChild, type MarkdownPostProcessorContext } from 'obsidian'
import { createApp, h } from 'vue'
import MermaidDiagram from '@/components/mermaid/MermaidDiagram.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { mermaidViewerActive } from './mermaidGate'

/** Before Obsidian's own processors, which all run at the default order of 0. */
export const MERMAID_PROCESSOR_ORDER = -100

export interface MermaidMount {
  source: string
  sourcePath: string
  edit?: () => void
}

/** Mounts the viewer into `host`. Returns what unmounts it. */
export function mountMermaid(host: HTMLElement, props: MermaidMount): () => void {
  const app = createApp({ render: () => h(MermaidDiagram, props) })
  app.mount(host)
  return () => app.unmount()
}

class MermaidChild extends MarkdownRenderChild {
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

/** The text of a code element as Obsidian reads it: without the newline the fence adds. */
const codeText = (code: Element): string => (code.textContent ?? '').replace(/\n$/, '')

export function mermaidPostProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
  const blocks = el.querySelectorAll('pre > code.language-mermaid')
  if (blocks.length === 0) return
  if (!mermaidViewerActive(GlobalStore.getInstance().app)) return

  for (const code of Array.from(blocks)) {
    const pre = code.parentElement
    if (!pre) continue
    const host = pre.doc.win.createDiv({ cls: 'abele-mermaid-host' })
    pre.replaceWith(host)
    const dispose = mountMermaid(host, { source: codeText(code), sourcePath: ctx.sourcePath })
    ctx.addChild(new MermaidChild(host, dispose))
  }
}
