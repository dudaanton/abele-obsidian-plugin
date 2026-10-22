/**
 * Takes Mermaid-source and pele alias fences before the host's diagram processor.
 * Disabled drawing removes the special language so the host keeps ordinary code.
 */
import { MarkdownRenderChild, type MarkdownPostProcessorContext } from 'obsidian'
import { h } from 'vue'
import MermaidDiagram from '@/components/mermaid/MermaidDiagram.vue'
import { mountKit } from '@/components/obsidian/mount'
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
  return mountKit(host, { render: () => h(MermaidDiagram, props) }).unmount
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
  const blocks = el.querySelectorAll('pre > code.language-mermaid, pre > code.language-pele')
  if (blocks.length === 0) return
  if (!mermaidViewerActive(GlobalStore.getInstance().app)) {
    for (const code of Array.from(blocks)) {
      code.classList.remove('language-mermaid', 'language-pele')
      code.classList.add('language-text')
    }
    return
  }

  for (const code of Array.from(blocks)) {
    const pre = code.parentElement
    if (!pre) continue
    const host = pre.doc.win.createDiv({ cls: 'abele-mermaid-host' })
    pre.replaceWith(host)
    const dispose = mountMermaid(host, { source: codeText(code), sourcePath: ctx.sourcePath })
    ctx.addChild(new MermaidChild(host, dispose))
  }
}
