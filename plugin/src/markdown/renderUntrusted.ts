/**
 * Obsidian runs installed plugins' processors even for chat and script output. Mark these
 * renders, then remove executable code languages before any other processor sees the DOM.
 * Text preparation alone cannot cover raw HTML or every markdown container edge case.
 * Nothing here changes image loading or ordinary notes.
 */
import {
  MarkdownPreviewRenderer,
  MarkdownRenderer,
  type Component,
  type MarkdownPostProcessor,
} from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { guardExternalLinks } from './externalLinks'
import { prepareMarkdown, finishCode, guardCode } from './untrustedCode'

export interface RenderPolicy {
  /** GitHub may supply additional pre/post-render rules; chat only guards code. */
  before?: (el: HTMLElement) => void
  after?: (el: HTMLElement) => void
  github?: boolean
}

const policies = new WeakMap<Element, RenderPolicy>()
const ATTR = 'data-abele-untrusted'

export function markUntrusted(el: HTMLElement, policy: RenderPolicy = {}): void {
  el.setAttribute(ATTR, '')
  policies.set(el, policy)
}

export const untrustedGuard: MarkdownPostProcessor = (el) => {
  // Only hosts we marked ourselves count, never an attribute written in supplied HTML.
  let host: Element | null = el
  while (host && !policies.has(host)) host = host.parentElement
  if (!host) return
  const policy = policies.get(host)!
  guardCode(el, !policy.github)
  policy.before?.(el)
}

export function installUntrustedGuard(): void {
  const renderer = MarkdownPreviewRenderer as unknown as {
    postProcessors?: MarkdownPostProcessor[]
  }
  if (!renderer.postProcessors?.includes(untrustedGuard))
    MarkdownPreviewRenderer.registerPostProcessor(untrustedGuard, -Number.MAX_VALUE)
  const list = renderer.postProcessors
  const at = list?.indexOf(untrustedGuard) ?? -1
  if (list && at > 0) {
    list.splice(at, 1)
    list.unshift(untrustedGuard)
  }
}

export function uninstallUntrustedGuard(): void {
  MarkdownPreviewRenderer.unregisterPostProcessor(untrustedGuard)
}

export async function renderUntrustedMarkdown(
  el: HTMLElement,
  text: string,
  component: Component,
  sourcePath = '',
  policy: RenderPolicy = {}
): Promise<void> {
  markUntrusted(el, policy)
  installUntrustedGuard()
  await MarkdownRenderer.render(
    GlobalStore.getInstance().app,
    prepareMarkdown(text, !policy.github),
    el,
    sourcePath,
    component
  )
  // Code is guarded before processors, not here after Abele has drawn its own blocks.
  policy.after?.(el)
  guardExternalLinks(el)
  finishCode(el)
}
