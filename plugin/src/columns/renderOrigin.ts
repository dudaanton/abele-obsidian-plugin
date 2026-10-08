import type { MarkdownPostProcessorContext, MarkdownSectionInformation } from 'obsidian'

const origins = new WeakMap<HTMLElement, MarkdownSectionInformation>()

/** Source provenance is provided before MarkdownRenderer starts, never inferred from a clicked DOM. */
export function setColumnRenderOrigin(
  host: HTMLElement,
  text: string,
  from: number,
  to: number
): void {
  origins.set(host, {
    text,
    lineStart: text.slice(0, from).split('\n').length - 1,
    lineEnd: text.slice(0, to).split('\n').length - 1,
  })
}
export function columnRenderContext(
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext
): MarkdownPostProcessorContext {
  const native = ctx.getSectionInfo(el)
  if (native) return ctx
  for (let parent: HTMLElement | null = el; parent; parent = parent.parentElement) {
    const origin = origins.get(parent)
    if (origin) return { ...ctx, getSectionInfo: () => origin }
  }
  return ctx
}
